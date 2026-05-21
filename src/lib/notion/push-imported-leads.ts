import type { GTMOSConfig } from '../config/types'
import { notionService } from '../services/notion'

/** Push scraped/imported rows to the Notion Leads CRM before SQLite. */
export function isNotionImportSyncEnabled(config: GTMOSConfig): boolean {
  if (process.env.NOTION_SYNC_ON_IMPORT === 'false') return false
  return Boolean(process.env.NOTION_API_KEY?.trim() && config.notion?.leads_ds?.trim())
}

export function recordToNotionLeadPayload(record: Record<string, unknown>): Record<string, unknown> {
  const first = String(record.first_name ?? record.firstName ?? '').trim()
  const last = String(record.last_name ?? record.lastName ?? '').trim()
  const fullName = String(record.name ?? '').trim() || [first, last].filter(Boolean).join(' ')

  const lines: string[] = []
  if (record.notes) lines.push(String(record.notes))
  if (record.profile_url) lines.push(`Profile: ${record.profile_url}`)
  if (record.linkedin_url) lines.push(`LinkedIn: ${record.linkedin_url}`)
  if (record.source) lines.push(`Source: ${record.source}`)
  if (record.source_detail) lines.push(String(record.source_detail))
  if (record.engagement_type) lines.push(`Intent: ${record.engagement_type}`)
  if (record.skool_slug) lines.push(`Skool: @${record.skool_slug}`)

  const description =
    lines.length > 0
      ? lines.join('\n\n')
      : record.description
        ? String(record.description)
        : undefined

  return {
    name: fullName || undefined,
    company_name: record.company_name ?? record.company,
    website: record.website ?? record.profile_url,
    industry: record.industry,
    location: record.location,
    description,
  }
}

export async function pushImportedLeadsToNotion(
  config: GTMOSConfig,
  records: Record<string, unknown>[],
): Promise<{ created: number; failed: number } | null> {
  if (!isNotionImportSyncEnabled(config)) return null

  const databaseId = config.notion.leads_ds
  const payloads = records.map(recordToNotionLeadPayload)

  console.log(`[import] Pushing ${payloads.length} scraped leads to Notion Leads DB...`)
  const result = await notionService.bulkCreateLeads(databaseId, payloads)
  console.log(`[import] Leads (scraped): ${result.created} created, ${result.failed} failed`)
  console.log(`[import] Open Leads DB: https://notion.so/${databaseId.replace(/-/g, '')}`)
  return result
}
