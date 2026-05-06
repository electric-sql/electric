import { describe, expect, it, vi } from 'vitest'
import { registerClient } from '../../src/auth/dcr'

describe(`registerClient`, () => {
  it(`POSTs metadata and returns client_id + client_secret`, async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ client_id: `cid`, client_secret: `csec` }),
    })) as unknown as typeof globalThis.fetch
    const r = await registerClient({
      registrationEndpoint: `https://x/register`,
      clientName: `electric-agents`,
      redirectUris: [`http://localhost:4437/oauth/callback/foo`],
      grantTypes: [`authorization_code`, `refresh_token`],
      fetch: f,
    })
    expect(r.clientId).toBe(`cid`)
    expect(r.clientSecret).toBe(`csec`)
  })

  it(`throws on non-200`, async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => `bad metadata`,
    })) as unknown as typeof globalThis.fetch
    await expect(
      registerClient({
        registrationEndpoint: `http://x/register`,
        clientName: `c`,
        redirectUris: [`http://cb`],
        grantTypes: [`authorization_code`],
        fetch: f,
      })
    ).rejects.toThrow(/400/)
  })
})
