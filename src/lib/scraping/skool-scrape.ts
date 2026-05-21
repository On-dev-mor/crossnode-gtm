/**
 * Skool scrape entry — Firecrawl first, Apify only when requested.
 */

import type { GTMOSConfig } from '../config/types.js'
import { scrapeSkoolViaFirecrawl, type ScrapeSkoolFeedResult } from './skool-feed.js'
import { scrapeSkoolViaApify, type ScrapeSkoolResult } from './skool-members.js'

export type SkoolScrapeProvider = 'firecrawl' | 'apify' | 'auto'

export interface ScrapeSkoolOptions {
  config: GTMOSConfig
  url: string
  maxLeads?: number
  output?: string
  communitySlug?: string
  provider?: SkoolScrapeProvider
  /** Apify-only */
  actorId?: string
}

export type ScrapeSkoolUnifiedResult = {
  resultSetId: string
  leadCount: number
  outputPath: string
  communityUrl: string
  provider: 'firecrawl' | 'apify'
  notionCreated?: number
  notionFailed?: number
}

function resolveProvider(explicit?: SkoolScrapeProvider): 'firecrawl' | 'apify' {
  if (explicit === 'apify') return 'apify'
  if (explicit === 'firecrawl') return 'firecrawl'
  const env = (process.env.SKOOL_SCRAPE_PROVIDER ?? 'firecrawl').trim().toLowerCase()
  if (env === 'apify') return 'apify'
  return 'firecrawl'
}

export async function scrapeSkoolCommunity(
  opts: ScrapeSkoolOptions,
): Promise<ScrapeSkoolUnifiedResult> {
  const provider = resolveProvider(opts.provider)

  if (provider === 'apify') {
    const r: ScrapeSkoolResult = await scrapeSkoolViaApify({
      config: opts.config,
      url: opts.url,
      maxMembers: opts.maxLeads,
      actorId: opts.actorId,
      output: opts.output,
      communitySlug: opts.communitySlug,
    })
    return {
      resultSetId: r.resultSetId,
      leadCount: r.memberCount,
      outputPath: r.outputPath,
      communityUrl: r.communityUrl,
      provider: 'apify',
    }
  }

  const r: ScrapeSkoolFeedResult = await scrapeSkoolViaFirecrawl({
    config: opts.config,
    url: opts.url,
    maxLeads: opts.maxLeads,
    output: opts.output,
    communitySlug: opts.communitySlug,
  })
  return {
    resultSetId: r.resultSetId,
    leadCount: r.leadCount,
    outputPath: r.outputPath,
    communityUrl: r.communityUrl,
    provider: 'firecrawl',
    notionCreated: r.notionCreated,
    notionFailed: r.notionFailed,
  }
}
