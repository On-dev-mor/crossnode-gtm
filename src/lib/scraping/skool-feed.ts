/**
 * Skool lead discovery via Firecrawl (no Apify).
 *
 * Scrapes public Skool pages:
 *   - {community}/-/members  — member list + bios (primary)
 *   - {community}            — recent post authors (secondary, higher intent)
 */

import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { firecrawlService } from '../services/firecrawl.js'
import { runImport } from '../qualification/importers.js'
import { pushImportedLeadsToNotion } from '../notion/push-imported-leads.js'
import { normalizeSkoolMember } from './skool-members.js'
import type { GTMOSConfig } from '../config/types.js'

export interface ScrapeSkoolFeedOptions {
  config: GTMOSConfig
  url: string
  maxLeads?: number
  output?: string
  communitySlug?: string
  /** Scrape members directory (default true). */
  includeMembers?: boolean
  /** Scrape community feed for post authors (default true). */
  includeFeed?: boolean
}

export interface ScrapeSkoolFeedResult {
  resultSetId: string
  leadCount: number
  outputPath: string
  communityUrl: string
  source: 'firecrawl'
  membersPageCount: number
  feedPageCount: number
  notionCreated?: number
  notionFailed?: number
}

const PROFILE_URL_RE = /https:\/\/www\.skool\.com\/@([a-z0-9._-]+)/gi
const DISPLAY_NAME_RE = /\[([^\]]+)\]\(https:\/\/www\.skool\.com\/@([a-z0-9._-]+)/gi

export function communitySlugFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts[0] ?? 'skool-community'
  } catch {
    return 'skool-community'
  }
}

export function membersPageUrl(communityUrl: string): string {
  const base = communityUrl.replace(/\/+$/, '')
  if (base.includes('/-/members')) return base
  return `${base}/-/members`
}

/** Parse Skool markdown for profile URLs, display names, and short bios. */
export function parseSkoolMarkdown(
  markdown: string,
  communitySlug: string,
  engagementType: 'member' | 'post_author',
): Record<string, unknown>[] {
  const bySlug = new Map<string, Record<string, unknown>>()

  for (const match of markdown.matchAll(DISPLAY_NAME_RE)) {
    const displayName = match[1].replace(/\\/g, '').trim()
    const slug = match[2].toLowerCase()
    if (!slug || slug.length < 2) continue
    const profileUrl = `https://www.skool.com/@${slug}?g=${communitySlug}`
    const existing = bySlug.get(slug) ?? {
      profile_url: profileUrl,
      skool_slug: slug,
      source: 'skool',
      source_detail: `skool:${communitySlug}`,
      engagement_type: engagementType,
    }
    if (displayName && !displayName.startsWith('![')) {
      existing.name = displayName
      const parts = displayName.split(/\s+/)
      existing.first_name = parts[0] ?? ''
      existing.last_name = parts.slice(1).join(' ')
    }
    bySlug.set(slug, existing)
  }

  for (const match of markdown.matchAll(PROFILE_URL_RE)) {
    const slug = match[1].toLowerCase()
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        profile_url: `https://www.skool.com/@${slug}?g=${communitySlug}`,
        skool_slug: slug,
        name: slug.replace(/-/g, ' '),
        source: 'skool',
        source_detail: `skool:${communitySlug}`,
        engagement_type: engagementType,
      })
    }
  }

  // Attach bio snippets after @handle on members page
  for (const [slug, row] of bySlug) {
    const atHandle = `@${slug}`
    const idx = markdown.indexOf(atHandle)
    if (idx === -1) continue
    const chunk = markdown.slice(idx, idx + 700)
    const bioMatch = chunk.match(/Chat\s*\n+\s*([^\n][\s\S]{8,280}?)(?=\n\n(?:Online|Joined|\[!\[))/i)
    if (bioMatch) {
      const bio = bioMatch[1].replace(/\s+/g, ' ').trim()
      if (bio.length > 10) {
        row.notes = bio.slice(0, 500)
        row.headline = bio.slice(0, 120)
      }
    }
  }

  return [...bySlug.values()].map(r => normalizeSkoolMember(r, communitySlug))
}

export async function scrapeSkoolViaFirecrawl(
  opts: ScrapeSkoolFeedOptions,
): Promise<ScrapeSkoolFeedResult> {
  if (!firecrawlService.isAvailable()) {
    throw new Error(
      'FIRECRAWL_API_KEY not set. Add it to ~/.gtm-os/.env — Skool scrape uses Firecrawl first (no Apify).',
    )
  }

  const communityUrl = opts.url.trim().replace(/\/+$/, '').split('/-/')[0]
  const slug = opts.communitySlug ?? communitySlugFromUrl(communityUrl)
  const maxLeads = opts.maxLeads ?? 200
  const includeMembers = opts.includeMembers !== false
  const includeFeed = opts.includeFeed !== false

  const merged = new Map<string, Record<string, unknown>>()
  let membersPageCount = 0
  let feedPageCount = 0

  if (includeMembers) {
    const membersUrl = membersPageUrl(communityUrl)
    console.log(`[scrape-skool] Firecrawl: members page ${membersUrl}`)
    const md = await firecrawlService.scrape(membersUrl)
    const parsed = parseSkoolMarkdown(md, slug, 'member')
    membersPageCount = parsed.length
    console.log(`[scrape-skool] Parsed ${membersPageCount} profiles from members page`)
    for (const row of parsed) {
      const key = String(row.skool_slug ?? row.profile_url ?? '')
      if (key) merged.set(key, row)
    }
  }

  if (includeFeed) {
    console.log(`[scrape-skool] Firecrawl: community feed ${communityUrl}`)
    const md = await firecrawlService.scrape(communityUrl)
    const parsed = parseSkoolMarkdown(md, slug, 'post_author')
    feedPageCount = parsed.length
    console.log(`[scrape-skool] Parsed ${feedPageCount} post authors from feed`)
    for (const row of parsed) {
      const key = String(row.skool_slug ?? row.profile_url ?? '')
      if (!key) continue
      const existing = merged.get(key)
      if (existing) {
        existing.engagement_type = 'post_author'
        if (!existing.notes && row.notes) existing.notes = row.notes
      } else {
        merged.set(key, row)
      }
    }
  }

  let leads = [...merged.values()].slice(0, maxLeads)
  if (leads.length === 0) {
    throw new Error(
      'Firecrawl returned no Skool profiles. Check the community URL is public and FIRECRAWL_API_KEY is valid.',
    )
  }

  const notionResult = await pushImportedLeadsToNotion(opts.config, leads)

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  const dataDir = join(homedir(), '.gtm-os', 'data', 'leads')
  mkdirSync(dataDir, { recursive: true })
  const outputPath = opts.output ?? join(dataDir, `skool_firecrawl_${slug}_${timestamp}.json`)
  writeFileSync(outputPath, JSON.stringify(leads, null, 2))
  console.log(`[scrape-skool] Local cache: ${outputPath}`)

  const imported = await runImport({
    config: opts.config,
    source: 'skool',
    input: outputPath,
    skipNotionPush: Boolean(notionResult),
  })
  console.log(`[scrape-skool] Imported result set: ${imported.resultSetId}`)

  return {
    resultSetId: imported.resultSetId,
    leadCount: leads.length,
    outputPath,
    communityUrl,
    source: 'firecrawl',
    membersPageCount,
    feedPageCount,
    notionCreated: notionResult?.created,
    notionFailed: notionResult?.failed,
  }
}
