import { describe, it, expect } from 'vitest'
import { parseSkoolMarkdown, membersPageUrl } from '../skool-feed.js'

const SAMPLE = `
[Michael Lietz](https://www.skool.com/@michael-lietz?g=ki-automatisierung-n8n-5350)
[@michael-lietz](https://www.skool.com/@michael-lietz?g=ki-automatisierung-n8n-5350)
Chat

Spekulant, Entwickler der 10% Aktien-Flipping Strategie
Online now
Joined Nov 6, 2025
`

describe('parseSkoolMarkdown', () => {
  it('extracts profile slugs and display names', () => {
    const rows = parseSkoolMarkdown(SAMPLE, 'ki-automatisierung-n8n-5350', 'member')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const michael = rows.find(r => String(r.skool_slug) === 'michael-lietz')
    expect(michael).toBeDefined()
    expect(michael?.name).toContain('Michael')
    expect(String(michael?.profile_url)).toContain('@michael-lietz')
    expect(michael?.source).toBe('skool')
  })

  it('builds members page URL', () => {
    expect(membersPageUrl('https://www.skool.com/ki-automatisierung-n8n-5350')).toBe(
      'https://www.skool.com/ki-automatisierung-n8n-5350/-/members',
    )
  })
})
