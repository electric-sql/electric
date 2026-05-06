import { describe, expect, it } from 'vitest'
import {
  AuthUnavailableError,
  createInMemoryTokenCache,
  createOAuthCoordinator,
} from '../../src/auth/coordinator'
import type { TokenSet } from '../../src/auth/client-credentials'

describe(`OAuthCoordinator`, () => {
  it(`serializes refresh: only one exchange runs for concurrent callers`, async () => {
    let exchangeCount = 0
    const coordinator = createOAuthCoordinator({
      doRefresh: async () => {
        exchangeCount++
        await new Promise((r) => setTimeout(r, 20))
        return {
          accessToken: `NEW`,
          expiresAt: new Date(Date.now() + 60_000),
          tokenType: `Bearer`,
        }
      },
      cache: {
        get: () => ({
          accessToken: `OLD`,
          refreshToken: `rt`,
          expiresAt: new Date(Date.now() - 1000),
          tokenType: `Bearer`,
        }),
        set: () => {},
      },
    })
    const [a, b, c] = await Promise.all([
      coordinator.getToken(`s`, [`x`]),
      coordinator.getToken(`s`, [`x`]),
      coordinator.getToken(`s`, [`x`]),
    ])
    expect([a, b, c]).toEqual([`NEW`, `NEW`, `NEW`])
    expect(exchangeCount).toBe(1)
  })

  it(`throws AuthUnavailable when no refresh token and no cached`, async () => {
    const c = createOAuthCoordinator({
      doRefresh: async () => {
        throw new Error(`no token`)
      },
      cache: { get: () => undefined, set: () => {} },
    })
    await expect(c.getToken(`s`, [`x`])).rejects.toBeInstanceOf(
      AuthUnavailableError
    )
  })

  it(`returns cached valid token without refreshing`, async () => {
    let refreshCalls = 0
    const cached: TokenSet = {
      accessToken: `CACHED`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      tokenType: `Bearer`,
    }
    const coordinator = createOAuthCoordinator({
      doRefresh: async () => {
        refreshCalls++
        return {
          accessToken: `SHOULD_NOT_HAPPEN`,
          expiresAt: new Date(Date.now() + 60_000),
          tokenType: `Bearer`,
        }
      },
      cache: { get: () => cached, set: () => {} },
    })
    const tok = await coordinator.getToken(`s`, [`x`])
    expect(tok).toBe(`CACHED`)
    expect(refreshCalls).toBe(0)
  })

  it(`uses different cache entries for different scope sets`, async () => {
    const cache = createInMemoryTokenCache()
    const seen: Array<{ server: string; scopeKey: string }> = []
    const coordinator = createOAuthCoordinator({
      doRefresh: async (server, scopes) => {
        const key = (scopes ?? []).slice().sort().join(` `)
        seen.push({ server, scopeKey: key })
        return {
          accessToken: `tok-${key}`,
          expiresAt: new Date(Date.now() + 60_000),
          tokenType: `Bearer`,
        }
      },
      cache,
    })
    const a = await coordinator.getToken(`srv`, [`read`])
    const b = await coordinator.getToken(`srv`, [`write`])
    const aAgain = await coordinator.getToken(`srv`, [`read`])
    expect(a).toBe(`tok-read`)
    expect(b).toBe(`tok-write`)
    expect(aAgain).toBe(`tok-read`)
    expect(seen).toHaveLength(2)
  })

  it(`treats scope order as equivalent`, async () => {
    const cache = createInMemoryTokenCache()
    let calls = 0
    const coordinator = createOAuthCoordinator({
      doRefresh: async () => {
        calls++
        return {
          accessToken: `T${calls}`,
          expiresAt: new Date(Date.now() + 60_000),
          tokenType: `Bearer`,
        }
      },
      cache,
    })
    const a = await coordinator.getToken(`srv`, [`a`, `b`])
    const b = await coordinator.getToken(`srv`, [`b`, `a`])
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  it(`setToken updates the cache`, async () => {
    const cache = createInMemoryTokenCache()
    let refreshCalls = 0
    const coordinator = createOAuthCoordinator({
      doRefresh: async () => {
        refreshCalls++
        return {
          accessToken: `REFRESHED`,
          expiresAt: new Date(Date.now() + 60_000),
          tokenType: `Bearer`,
        }
      },
      cache,
    })
    coordinator.setToken(`srv`, [`x`], {
      accessToken: `INJECTED`,
      expiresAt: new Date(Date.now() + 60_000),
      tokenType: `Bearer`,
    })
    const tok = await coordinator.getToken(`srv`, [`x`])
    expect(tok).toBe(`INJECTED`)
    expect(refreshCalls).toBe(0)
  })

  it(`releases the inflight slot after refresh fails so subsequent calls retry`, async () => {
    let attempt = 0
    const coordinator = createOAuthCoordinator({
      doRefresh: async () => {
        attempt++
        if (attempt === 1) throw new Error(`boom`)
        return {
          accessToken: `OK`,
          expiresAt: new Date(Date.now() + 60_000),
          tokenType: `Bearer`,
        }
      },
      cache: { get: () => undefined, set: () => {} },
    })
    await expect(coordinator.getToken(`s`, [`x`])).rejects.toBeInstanceOf(
      AuthUnavailableError
    )
    const tok = await coordinator.getToken(`s`, [`x`])
    expect(tok).toBe(`OK`)
    expect(attempt).toBe(2)
  })
})

describe(`createInMemoryTokenCache`, () => {
  it(`round-trips tokens by server and scope key`, () => {
    const cache = createInMemoryTokenCache()
    const t: TokenSet = {
      accessToken: `A`,
      expiresAt: new Date(Date.now() + 60_000),
      tokenType: `Bearer`,
    }
    expect(cache.get(`srv`, `read`)).toBeUndefined()
    cache.set(`srv`, `read`, t)
    expect(cache.get(`srv`, `read`)).toEqual(t)
    expect(cache.get(`srv`, `write`)).toBeUndefined()
    expect(cache.get(`other`, `read`)).toBeUndefined()
  })
})
