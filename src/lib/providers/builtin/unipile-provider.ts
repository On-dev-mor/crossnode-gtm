import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability, ProviderHealthStatus } from '../types'
import type { ColumnDef } from '../../ai/types'
import { join } from 'path'
import { unipileService } from '../../services/unipile'
import { SEARCH_COLUMNS } from '../../execution/columns'

const LINKEDIN_COLUMNS: ColumnDef[] = [
  ...SEARCH_COLUMNS,
  { key: 'first_name', label: 'First Name', type: 'text' },
  { key: 'last_name', label: 'Last Name', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
]

export class UnipileProvider implements StepExecutor {
  id = 'unipile'
  name = 'Unipile (LinkedIn + Email)'
  description = 'LinkedIn search, connections, DMs, post engagers, and cold email via connected Gmail/Outlook/IMAP accounts.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich', 'linkedin_send', 'email_send']

  isAvailable(): boolean {
    return unipileService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'unipile') return true
    if (step.stepType === 'linkedin_send') return true
    if (step.stepType === 'email_send') return true
    // Claim steps that mention LinkedIn
    const query = String(step.config?.query ?? step.description ?? '').toLowerCase()
    const url = String(step.config?.url ?? '').toLowerCase()
    if (query.includes('linkedin') || url.includes('linkedin.com')) {
      return step.stepType === 'search' || step.stepType === 'enrich'
    }
    return false
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!unipileService.isAvailable()) {
      return { ok: false, message: 'UNIPILE_API_KEY or UNIPILE_DSN not set' }
    }
    try {
      await Promise.race([
        unipileService.getAccounts(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Unipile health check timed out after 5s')), 5000),
        ),
      ])
      return { ok: true, message: 'Unipile accounts endpoint reachable' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async selfHealthCheck(): Promise<ProviderHealthStatus> {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      return { status: 'warn', detail: 'UNIPILE_API_KEY or UNIPILE_DSN not set' }
    }
    try {
      const accountsResponse = await Promise.race([
        unipileService.getAccounts(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout after 8s')), 8000),
        ),
      ])
      const items = (accountsResponse as { items?: Array<Record<string, unknown>> })?.items ?? []
      const linkedin = items.filter((item) => String(item.type ?? '').toUpperCase() === 'LINKEDIN')
      const email = items.filter((item) => {
        const type = String(item.type ?? '').toUpperCase()
        return type !== 'LINKEDIN' && type !== ''
      })
      if (linkedin.length === 0 && email.length === 0) {
        return { status: 'warn', detail: 'connected but no LinkedIn or email accounts attached' }
      }
      const parts: string[] = []
      if (linkedin.length > 0) parts.push(`${linkedin.length} LinkedIn`)
      if (email.length > 0) parts.push(`${email.length} email`)
      return { status: 'ok', detail: `${parts.join(', ')} account(s) connected` }
    } catch (err) {
      return {
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    if (step.stepType === 'email_send') {
      const cfg = (step.config ?? {}) as Record<string, unknown>
      const payload = ((step as Record<string, unknown>).payload ?? {}) as Record<string, unknown>
      const merged = { ...cfg, ...payload }

      const to = String(merged.to ?? '')
      const subject = merged.subject != null ? String(merged.subject) : '(no subject)'
      const body = String(merged.body ?? '')
      const accountId = await this.resolveEmailAccountId(
        merged.accountId != null ? String(merged.accountId) : undefined,
      )

      if (!to || !body) {
        throw new Error('[unipile-provider] email_send requires "to" and "body" in step.config or step.payload')
      }

      const displayName = merged.first_name != null
        ? [merged.first_name, merged.last_name].filter(Boolean).join(' ').trim()
        : undefined

      const fromLine = await this.resolveEmailFromLine(accountId)

      await unipileService.sendEmail({
        accountId,
        to,
        subject,
        body,
        toDisplayName: displayName || undefined,
        from: fromLine,
      })

      yield {
        rows: [{
          to,
          subject,
          status: 'sent',
          provider: 'unipile',
          unipile_account_id: accountId,
        }],
        batchIndex: 0,
        totalSoFar: 1,
      }
      return
    }

    // Resolve LinkedIn account (never pick an email mailbox here)
    const accountId = await this.resolveLinkedInAccountId(
      (step.config as Record<string, unknown> | undefined)?.accountId != null
        ? String((step.config as Record<string, unknown>).accountId)
        : undefined,
    )

    // linkedin_send — sub-discriminator on payload.kind: 'connect' | 'dm'
    if (step.stepType === 'linkedin_send') {
      const cfg = (step.config ?? {}) as Record<string, unknown>
      const payload = ((step as Record<string, unknown>).payload ?? {}) as Record<string, unknown>
      const merged = { ...cfg, ...payload }

      const kind = String(merged.kind ?? 'dm')
      const overrideAccountId = merged.accountId != null ? String(merged.accountId) : null
      const useAccount = overrideAccountId ?? accountId

      if (kind === 'connect') {
        const providerId = merged.providerId != null ? String(merged.providerId) : ''
        if (!providerId) {
          throw new Error('[unipile-provider] linkedin_send kind=connect requires "providerId" in step.config or step.payload')
        }
        const message = merged.message != null ? String(merged.message) : undefined
        await unipileService.sendConnection(useAccount, providerId, message)
        yield {
          rows: [{ kind: 'connect', provider_id: providerId, status: 'queued', provider: 'unipile' }],
          batchIndex: 0,
          totalSoFar: 1,
        }
        return
      }

      if (kind === 'dm') {
        const attendeeId = merged.attendeeId != null ? String(merged.attendeeId) : ''
        const text = merged.text != null ? String(merged.text) : ''
        if (!attendeeId || !text) {
          throw new Error('[unipile-provider] linkedin_send kind=dm requires "attendeeId" and "text" in step.config or step.payload')
        }
        await unipileService.sendMessage(useAccount, attendeeId, text)
        yield {
          rows: [{ kind: 'dm', attendee_id: attendeeId, status: 'queued', provider: 'unipile' }],
          batchIndex: 0,
          totalSoFar: 1,
        }
        return
      }

      throw new Error(`[unipile-provider] linkedin_send kind must be 'connect' or 'dm', got "${kind}"`)
    }

    // Enrich mode: get profile for each row's LinkedIn slug
    if (step.stepType === 'enrich' && context.previousStepRows?.length) {
      const batchSize = context.batchSize || 10
      let totalSoFar = 0

      for (let i = 0; i < context.previousStepRows.length; i += batchSize) {
        const slice = context.previousStepRows.slice(i, i + batchSize)
        const enriched = await Promise.all(
          slice.map(async (row) => {
            const linkedinUrl = String(row.linkedin_url ?? row.linkedin ?? '')
            if (!linkedinUrl) return row
            try {
              const profile = await unipileService.getProfile(accountId, linkedinUrl)
              return { ...row, ...this.normalizeProfile(profile) }
            } catch {
              return row
            }
          }),
        )
        totalSoFar += enriched.length
        yield { rows: enriched, batchIndex: Math.floor(i / batchSize), totalSoFar }
      }
      return
    }

    // Search mode: search LinkedIn people
    const query = step.config?.query ? String(step.config.query) : step.description
    const limit = context.totalRequested || 25
    const results = await unipileService.searchLinkedIn(accountId, query, limit)

    const rows = results.map((item) => this.normalizeProfile(item))

    if (rows.length === 0) {
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      return
    }

    const batchSize = context.batchSize || 10
    let totalSoFar = 0
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize)
      totalSoFar += slice.length
      yield { rows: slice, batchIndex: Math.floor(i / batchSize), totalSoFar }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return LINKEDIN_COLUMNS
  }

  private normalizeProfile(data: unknown): Record<string, unknown> {
    const d = (data ?? {}) as Record<string, unknown>
    return {
      first_name: d.first_name ?? d.firstName ?? '',
      last_name: d.last_name ?? d.lastName ?? '',
      title: d.headline ?? d.title ?? d.occupation ?? '',
      company_name: d.company_name ?? d.company ?? d.organization ?? '',
      website: d.website ?? d.websites ?? '',
      industry: d.industry ?? '',
      location: d.location ?? d.geo_location ?? '',
      description: d.summary ?? d.description ?? '',
      linkedin_url: d.linkedin_url ?? d.public_identifier
        ? `https://linkedin.com/in/${d.public_identifier}`
        : d.profile_url ?? '',
      employee_count: '',
    }
  }

  private async resolveLinkedInAccountId(explicit?: string): Promise<string> {
    if (explicit) return explicit

    try {
      const { loadConfig } = await import('../../config/loader.js')
      const { homedir } = await import('os')
      const { readFileSync, existsSync } = await import('fs')
      const cfgPath = process.env.GTM_OS_CONFIG ?? join(homedir(), '.gtm-os', 'config.yaml')
      loadConfig(cfgPath.replace('~', homedir()))

      const ctxPath = join(homedir(), '.gtm-os', 'company_context.yaml')
      if (existsSync(ctxPath)) {
        const yaml = (await import('js-yaml')).default
        const ctx = yaml.load(readFileSync(ctxPath, 'utf-8')) as { sources?: { linkedin_account_id?: string } }
        if (ctx.sources?.linkedin_account_id) return ctx.sources.linkedin_account_id
      }
    } catch {
      // fall through
    }

    const accountsResponse = await unipileService.getAccounts()
    const accounts = (accountsResponse?.items ?? []).filter((item) => {
      const type = String((item as Record<string, unknown>).type ?? '').toUpperCase()
      return type === 'LINKEDIN'
    })
    if (accounts.length === 0) {
      throw new Error('No LinkedIn account connected in Unipile. Connect one first or set sources.linkedin_account_id in company_context.yaml')
    }
    return String((accounts[0] as Record<string, unknown>).id)
  }

  private async resolveEmailFromLine(
    accountId: string,
  ): Promise<{ display_name: string; identifier: string } | undefined> {
    try {
      const { loadConfig } = await import('../../config/loader.js')
      const { resolveEmailFrom } = await import('../../email/from-line.js')
      const { homedir } = await import('os')
      const cfgPath = process.env.GTM_OS_CONFIG ?? join(homedir(), '.gtm-os', 'config.yaml')
      const config = loadConfig(cfgPath.replace('~', homedir()))
      const accounts = await unipileService.listEmailAccounts()
      const mailbox = accounts.find((a) => a.id === accountId)?.email
      return resolveEmailFrom(config, mailbox)
    } catch {
      return undefined
    }
  }

  private async resolveEmailAccountId(explicit?: string): Promise<string> {
    if (explicit) return explicit
    if (process.env.UNIPILE_EMAIL_ACCOUNT_ID) return process.env.UNIPILE_EMAIL_ACCOUNT_ID

    try {
      const { loadConfig } = await import('../../config/loader.js')
      const { homedir } = await import('os')
      const { readFileSync, existsSync } = await import('fs')
      const cfgPath = process.env.GTM_OS_CONFIG ?? join(homedir(), '.gtm-os', 'config.yaml')
      const config = loadConfig(cfgPath.replace('~', homedir()))
      if (config.unipile.email_account_id) return config.unipile.email_account_id

      const ctxPath = join(homedir(), '.gtm-os', 'company_context.yaml')
      if (existsSync(ctxPath)) {
        const yaml = (await import('js-yaml')).default
        const ctx = yaml.load(readFileSync(ctxPath, 'utf-8')) as { sources?: { email_account_id?: string } }
        if (ctx.sources?.email_account_id) return ctx.sources.email_account_id
      }
    } catch {
      // fall through
    }

    const emailAccounts = await unipileService.listEmailAccounts()
    if (emailAccounts.length === 0) {
      throw new Error(
        'No email account connected in Unipile. Connect Gmail/Outlook in Unipile dashboard or set unipile.email_account_id in ~/.gtm-os/config.yaml',
      )
    }
    return emailAccounts[0].id
  }
}
