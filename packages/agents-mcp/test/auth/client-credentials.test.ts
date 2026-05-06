import { describe, expect, it, vi, beforeEach } from 'vitest'
import { exchangeClientCredentials } from '../../src/auth/client-credentials'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe(`exchangeClientCredentials`, () => {
  it(`POSTs and returns access token`, async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: `AT`,
        expires_in: 3600,
        token_type: `Bearer`,
      }),
    })) as unknown as typeof globalThis.fetch
    const tok = await exchangeClientCredentials({
      tokenUrl: `https://x/token`,
      clientId: `id`,
      clientSecret: `sec`,
      scopes: [`s`],
      fetch: f,
    })
    expect(tok.accessToken).toBe(`AT`)
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now())
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls
    const init = calls[0][1]
    expect((init.body as URLSearchParams).toString()).toContain(
      `grant_type=client_credentials`
    )
  })

  it(`throws on non-200`, async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => `no`,
    })) as unknown as typeof globalThis.fetch
    await expect(
      exchangeClientCredentials({
        tokenUrl: `http://x`,
        clientId: `i`,
        clientSecret: `s`,
        fetch: f,
      })
    ).rejects.toThrow(/401/)
  })
})
