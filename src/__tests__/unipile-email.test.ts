import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('unipileService.sendEmail', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.UNIPILE_DSN = 'https://api42.unipile.com:17248'
    process.env.UNIPILE_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.resetModules()
  })

  it('posts JSON payload to /api/v1/emails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg_123' }),
    })
    global.fetch = fetchMock as typeof fetch

    const { unipileService } = await import('../lib/services/unipile')
    const result = await unipileService.sendEmail({
      accountId: 'e4AxbbKZQna-5D_pyW-WnQ',
      to: 'prospect@example.com',
      subject: 'Hello',
      body: 'Quick note about automation.',
      toDisplayName: 'Jane Doe',
    })

    expect(result).toEqual({ id: 'msg_123' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api42.unipile.com:17248/api/v1/emails')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-API-KEY': 'test-key',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      account_id: 'e4AxbbKZQna-5D_pyW-WnQ',
      subject: 'Hello',
      body: 'Quick note about automation.',
      to: [{ identifier: 'prospect@example.com', display_name: 'Jane Doe' }],
    })
  })

  it('filters email accounts out of LinkedIn account lists', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 'li_1', type: 'LINKEDIN' },
          { id: 'mail_1', type: 'GOOGLE', email: 'outreach@crossnode.sh' },
        ],
      }),
    })
    global.fetch = fetchMock as typeof fetch

    const { unipileService } = await import('../lib/services/unipile')
    const emails = await unipileService.listEmailAccounts()
    expect(emails).toEqual([
      { id: 'mail_1', type: 'GOOGLE', name: undefined, email: 'outreach@crossnode.sh' },
    ])
  })
})
