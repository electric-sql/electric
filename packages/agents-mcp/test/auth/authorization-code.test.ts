import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshToken,
} from '../../src/auth/authorization-code'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe(`authorizationCode`, () => {
  it(`builds URL with PKCE + state`, () => {
    const { url, state, verifier } = buildAuthorizationUrl({
      authorizationUrl: `https://x/authorize`,
      clientId: `cid`,
      redirectUri: `http://localhost/cb`,
      scopes: [`repo`, `read:user`],
    })
    const u = new URL(url)
    expect(u.searchParams.get(`client_id`)).toBe(`cid`)
    expect(u.searchParams.get(`code_challenge_method`)).toBe(`S256`)
    expect(u.searchParams.get(`state`)).toBe(state)
    expect(u.searchParams.get(`response_type`)).toBe(`code`)
    expect(u.searchParams.get(`redirect_uri`)).toBe(`http://localhost/cb`)
    expect(u.searchParams.get(`scope`)).toBe(`repo read:user`)
    expect(u.searchParams.get(`code_challenge`)).toBeTruthy()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it(`includes resource when provided`, () => {
    const { url } = buildAuthorizationUrl({
      authorizationUrl: `https://x/authorize`,
      clientId: `cid`,
      redirectUri: `http://localhost/cb`,
      resource: `https://api.example.com`,
    })
    const u = new URL(url)
    expect(u.searchParams.get(`resource`)).toBe(`https://api.example.com`)
  })

  it(`omits scope when no scopes provided`, () => {
    const { url } = buildAuthorizationUrl({
      authorizationUrl: `https://x/authorize`,
      clientId: `cid`,
      redirectUri: `http://localhost/cb`,
    })
    const u = new URL(url)
    expect(u.searchParams.get(`scope`)).toBeNull()
  })

  it(`exchangeAuthorizationCode posts code + verifier`, async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: `AT`, expires_in: 3600 }),
    })) as unknown as typeof globalThis.fetch
    const tok = await exchangeAuthorizationCode({
      tokenUrl: `http://t`,
      clientId: `c`,
      redirectUri: `http://cb`,
      code: `the_code`,
      verifier: `v`,
      fetch: f,
    })
    expect(tok.accessToken).toBe(`AT`)
    expect(tok.tokenType).toBe(`Bearer`)
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now())
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls
    const init = calls[0][1]
    const bodyStr = (init.body as URLSearchParams).toString()
    expect(bodyStr).toContain(`grant_type=authorization_code`)
    expect(bodyStr).toContain(`code=the_code`)
    expect(bodyStr).toContain(`code_verifier=v`)
    expect(bodyStr).toContain(`client_id=c`)
  })

  it(`exchangeAuthorizationCode throws on non-200`, async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => `bad`,
    })) as unknown as typeof globalThis.fetch
    await expect(
      exchangeAuthorizationCode({
        tokenUrl: `http://t`,
        clientId: `c`,
        redirectUri: `http://cb`,
        code: `x`,
        verifier: `v`,
        fetch: f,
      })
    ).rejects.toThrow(/400/)
  })

  it(`refreshToken posts refresh grant`, async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: `NEW`, expires_in: 3600 }),
    })) as unknown as typeof globalThis.fetch
    const tok = await refreshToken({
      tokenUrl: `http://t`,
      clientId: `c`,
      refreshToken: `rt`,
      fetch: f,
    })
    expect(tok.accessToken).toBe(`NEW`)
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls
    const init = calls[0][1]
    const bodyStr = (init.body as URLSearchParams).toString()
    expect(bodyStr).toContain(`grant_type=refresh_token`)
    expect(bodyStr).toContain(`refresh_token=rt`)
    expect(bodyStr).toContain(`client_id=c`)
  })

  it(`refreshToken throws on non-200`, async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => `no`,
    })) as unknown as typeof globalThis.fetch
    await expect(
      refreshToken({
        tokenUrl: `http://t`,
        clientId: `c`,
        refreshToken: `rt`,
        fetch: f,
      })
    ).rejects.toThrow(/401/)
  })
})
