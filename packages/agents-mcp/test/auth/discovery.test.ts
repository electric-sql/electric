import { describe, expect, it, vi } from 'vitest'
import { discoverAuthServer } from '../../src/auth/discovery'

describe(`discoverAuthServer`, () => {
  it(`follows RFC 9728 chain`, async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith(`/.well-known/oauth-protected-resource`)) {
        return {
          ok: true,
          json: async () => ({
            authorization_servers: [`https://auth.example.com`],
          }),
        } as unknown as Response
      }
      if (
        u === `https://auth.example.com/.well-known/oauth-authorization-server`
      ) {
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: `https://auth.example.com/authorize`,
            token_endpoint: `https://auth.example.com/token`,
            registration_endpoint: `https://auth.example.com/register`,
          }),
        } as unknown as Response
      }
      return {
        ok: false,
        status: 404,
        text: async () => `nope`,
      } as unknown as Response
    })
    const m = await discoverAuthServer(
      `https://api.example.com/mcp`,
      f as unknown as typeof globalThis.fetch
    )
    expect(m.authorizationEndpoint).toBe(`https://auth.example.com/authorize`)
    expect(m.tokenEndpoint).toBe(`https://auth.example.com/token`)
    expect(m.registrationEndpoint).toBe(`https://auth.example.com/register`)
  })
})
