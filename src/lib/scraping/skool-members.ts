/**
 * Skool community member fetch via Apify actors.
 *
 * Skool has no first-party API in Crossnode GTM. This module runs a configurable
 * Apify actor (default: scrapestorm/skool-group-members-scraper) and imports
 * members into SQLite for qualify → Notion → outreach.
 *
 * Env:
 *   APIFY_API_TOKEN — required
 *   APIFY_SKOOL_ACTOR_ID — optional, default scrapestorm~skool-group-members-scraper---cheap-per-results
 */

import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { runImport } from '../qualification/importers.js'
import { pushImportedLeadsToNotion } from '../notion/push-imported-leads.js'
import type { GTMOSConfig } from '../config/types.js'

const DEFAULT_ACTOR = 'scrapestorm~skool-group-members-scraper---cheap-per-results'
const APIFY_BASE = 'https://api.apify.com/v2'

export interface ScrapeSkoolOptions {
  config: GTMOSConfig
  url: string
  maxMembers?: number
  actorId?: string
  output?: string
  /** Slug for source_detail, e.g. ki-automatisierung-n8n-5350 */
  communitySlug?: string
}

export interface ScrapeSkoolResult {
  resultSetId: string
  memberCount: number
  outputPath: string
  communityUrl: string
}

function apifyToken(): string {
  const t = process.env.APIFY_API_TOKEN?.trim()
  if (!t) {
    throw new Error(
      'APIFY_API_TOKEN not set. Create a token at https://console.apify.com/account/integrations ' +
        'then add it to ~/.gtm-os/.env. See docs: Apify Skool Group Members Scraper.',
    )
  }
  return t
}

function resolveActorId(override?: string): string {
  const raw = (override ?? process.env.APIFY_SKOOL_ACTOR_ID ?? DEFAULT_ACTOR).trim()
  return raw.includes('~') ? raw : raw.replace(/\//g, '~')
}

function communitySlugFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? 'skool-community'
  } catch {
    return 'skool-community'
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

/** Normalize heterogeneous Apify actor rows into lead import shape. */
export function normalizeSkoolMember(
  row: Record<string, unknown>,
  communitySlug: string,
): Record<string, unknown> {
  const fullName = String(
    row.name ?? row.fullName ?? row.full_name ?? row.displayName ?? row.username ?? '',
  )
  const { firstName, lastName } = splitName(fullName)
  const social = row.socialLinks as Record<string, unknown> | undefined
  const linkedin =
    row.linkedin ??
    row.linkedinUrl ??
    row.linkedin_url ??
    social?.linkedin ??
    ''
  const email = row.email ?? row.emailAddress ?? ''

  const slug = String(row.skool_slug ?? '')
  const profileUrl = String(
    row.profileUrl ?? row.profile_url ?? (slug ? `https://www.skool.com/@${slug}?g=${communitySlug}` : ''),
  )

  return {
    first_name: firstName,
    last_name: lastName,
    name: fullName || [firstName, lastName].filter(Boolean).join(' '),
    headline: String(row.bio ?? row.headline ?? row.title ?? ''),
    company: String(row.company ?? ''),
    email: email ? String(email) : '',
    linkedin_url: linkedin ? String(linkedin) : '',
    profile_url: profileUrl,
    skool_slug: slug,
    source: 'skool',
    source_detail: `skool:${communitySlug}`,
    notes: String(row.notes ?? row.bio ?? row.level ?? '').slice(0, 500),
    engagement_type: String(row.engagement_type ?? 'member'),
  }
}

async function apifyFetch(path: string, init?: RequestInit): Promise<unknown> {
  const token = apifyToken()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${APIFY_BASE}${path}${sep}token=${encodeURIComponent(token)}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Apify API failed (${res.status}): ${text.slice(0, 500)}`)
  }
  return res.json()
}

async function runApifyActor(actorId: string, input: Record<string, unknown>): Promise<string> {
  const started = (await apifyFetch(`/acts/${actorId}/runs`, {
    method: 'POST',
    body: JSON.stringify(input),
  })) as { data?: { id?: string; defaultDatasetId?: string } }

  const runId = started?.data?.id
  if (!runId) throw new Error('Apify run started but no run id returned')

  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000))
    const status = (await apifyFetch(`/actor-runs/${runId}`)) as {
      data?: { status?: string; defaultDatasetId?: string }
    }
    const st = status?.data?.status
    if (st === 'SUCCEEDED') {
      const ds = status?.data?.defaultDatasetId
      if (!ds) throw new Error('Apify run succeeded but no dataset id')
      return ds
    }
    if (st === 'FAILED' || st === 'ABORTED' || st === 'TIMED-OUT') {
      throw new Error(`Apify run ended with status: ${st}`)
    }
    console.log(`[scrape-skool] Apify run ${runId} status: ${st ?? 'RUNNING'}...`)
  }
  throw new Error('Apify run timed out after 10 minutes')
}

async function fetchDatasetItems(datasetId: string): Promise<Record<string, unknown>[]> {
  const data = (await apifyFetch(
    `/datasets/${datasetId}/items?clean=true&format=json&limit=5000`,
  )) as unknown
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  return []
}

/** Apify member scrape — use only when Firecrawl is insufficient or `--provider apify`. */
export async function scrapeSkoolViaApify(opts: ScrapeSkoolOptions): Promise<ScrapeSkoolResult> {
  const url = opts.url.trim()
  if (!url.includes('skool.com')) {
    throw new Error(`Invalid Skool URL: ${url}`)
  }

  const slug = opts.communitySlug ?? communitySlugFromUrl(url)
  const actorId = resolveActorId(opts.actorId)
  const maxMembers = opts.maxMembers ?? 200

  console.log(`[scrape-skool] Community: ${url}`)
  console.log(`[scrape-skool] Apify actor: ${actorId} (max ${maxMembers} members)`)

  const input: Record<string, unknown> = {
    groupUrl: url,
    startUrl: url,
    url,
    maxMembers,
    maxResults: maxMembers,
  }

  const datasetId = await runApifyActor(actorId, input)
  const raw = await fetchDatasetItems(datasetId)
  console.log(`[scrape-skool] Apify returned ${raw.length} rows`)

  const members = raw.map(r => normalizeSkoolMember(r, slug))
  if (members.length === 0) {
    throw new Error(
      'Apify returned 0 members. Check the community URL is public, your Apify credits, ' +
        `and APIFY_SKOOL_ACTOR_ID (current: ${actorId}).`,
    )
  }

  const notionResult = await pushImportedLeadsToNotion(opts.config, members)

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  const dataDir = join(homedir(), '.gtm-os', 'data', 'leads')
  mkdirSync(dataDir, { recursive: true })
  const outputPath = opts.output ?? join(dataDir, `skool_scrape_${slug}_${timestamp}.json`)
  writeFileSync(outputPath, JSON.stringify(members, null, 2))
  console.log(`[scrape-skool] Local cache: ${outputPath}`)

  const imported = await runImport({
    config: opts.config,
    source: 'skool',
    input: outputPath,
    skipNotionPush: Boolean(notionResult),
  })
  console.log(`[scrape-skool] Imported into result set: ${imported.resultSetId}`)

  return {
    resultSetId: imported.resultSetId,
    memberCount: members.length,
    outputPath,
    communityUrl: url,
  }
}
