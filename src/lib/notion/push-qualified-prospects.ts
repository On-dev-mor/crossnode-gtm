import type { GTMOSConfig } from '../config/types'
import { notionService } from '../services/notion'

export function isProspectsNotionSyncEnabled(config: GTMOSConfig): boolean {
  return Boolean(process.env.NOTION_API_KEY?.trim() && config.notion?.prospects_ds?.trim())
}

function rt(text: string): { rich_text: { text: { content: string } }[] } {
  return { rich_text: [{ text: { content: text.slice(0, 2000) } }] }
}

export function qualifiedLeadToNotionProperties(lead: Record<string, unknown>): Record<string, unknown> {
  const first = String(lead.first_name ?? lead.firstName ?? '').trim()
  const last = String(lead.last_name ?? lead.lastName ?? '').trim()
  const name = [first, last].filter(Boolean).join(' ') || String(lead.name ?? lead.company_name ?? 'Unknown')

  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: name } }] },
    'Lifecycle Status': { select: { name: String(lead.lifecycleStatus ?? 'Qualified') } },
  }

  const company = String(lead.company ?? lead.company_name ?? '').trim()
  if (company) properties.Company = rt(company)

  const headline = String(lead.headline ?? lead.title ?? '').trim()
  if (headline) properties.Title = rt(headline)

  const linkedin = String(lead.linkedin_url ?? lead.linkedinUrl ?? '').trim()
  if (linkedin) {
    const url = linkedin.startsWith('http') ? linkedin : `https://${linkedin}`
    properties['LinkedIn URL'] = { url }
  }

  const source = String(lead.source ?? '').trim()
  if (source) properties.Source = { select: { name: source } }

  const score = Number(lead.icp_score ?? lead.qualificationScore ?? 0)
  if (score > 0) properties.Score = { number: score }

  const providerId = String(lead.provider_id ?? lead.providerId ?? '').trim()
  if (providerId) properties['Provider ID'] = rt(providerId)

  return properties
}

export async function pushQualifiedProspectsToNotion(
  config: GTMOSConfig,
  leads: Record<string, unknown>[],
): Promise<{ created: number; failed: number; pageIds: string[] } | null> {
  if (!isProspectsNotionSyncEnabled(config)) return null

  const databaseId = config.notion.prospects_ds
  const propertySets = leads.map(qualifiedLeadToNotionProperties)

  console.log(`[qualify] Pushing ${propertySets.length} qualified prospects to Notion...`)
  const result = await notionService.bulkCreateWithProperties(databaseId, propertySets)
  console.log(`[qualify] Prospects DB: ${result.created} created, ${result.failed} failed`)
  console.log(`[qualify] Open Prospects DB: https://notion.so/${databaseId.replace(/-/g, '')}`)
  return result
}
