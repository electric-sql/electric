import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry'
import type { RegistryOpts } from '../src/registry'
import { testAuthStore } from './helpers/credentials'

describe(`Registry — OAuth`, () => {
  it(`authorizationCode without saved tokens returns authenticating + authUrl`, async () => {
    const opts: RegistryOpts = {
      publicUrl: `http://r:4448`,
      transportFactoryOverride: (_cfg, _hp, provider) => ({
        client: {
          listTools: async () => ({ tools: [] }),
          close: async () => {},
        } as any,
        connect: async () => {
          provider!.redirectToAuthorization(
            new URL(`https://provider/authorize?x=1`)
          )
          throw new Error(`UnauthorizedError`)
        },
        close: async () => {},
      }),
    }
    const reg = createRegistry(opts)
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        // Pre-registered client (skips DCR for the test).
        client: { clientId: `cid` },
      },
    })
    expect(r.state).toBe(`authenticating`)
    if (r.state === `authenticating`) expect(r.authUrl).toContain(`authorize`)
  })

  it(`clientCredentials: connects when tokens exchange succeeds`, async () => {
    const opts: RegistryOpts = {
      publicUrl: `http://r:4448`,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({
            tools: [{ name: `t`, inputSchema: {} }],
          }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    }
    const reg = createRegistry(opts)
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `clientCredentials`,
        tokenUrl: `https://x/token`,
        clientId: `cid`,
        clientSecret: `sec`,
      },
    })
    expect(r.state).toBe(`ready`)
  })

  it(`clientCredentials: missing inline secret returns auth_unavailable`, async () => {
    const reg = createRegistry({ publicUrl: `http://r:4448` })
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      // @ts-expect-error — purposely missing clientId/clientSecret
      auth: { mode: `clientCredentials`, tokenUrl: `https://x/token` },
    })
    expect(r.state).toBe(`error`)
    if (r.state === `error`) {
      expect(r.error.kind).toBe(`auth_unavailable`)
      expect(r.error.message).toMatch(/clientCredentials/)
    }
  })

  it(`clientCredentials: cached token skips re-fetch on second call`, async () => {
    let fetchCallCount = 0
    const globalFetch = vi.fn(async () => {
      fetchCallCount += 1
      return new Response(
        JSON.stringify({
          access_token: `AT`,
          expires_in: 3600,
          token_type: `Bearer`,
        })
      )
    })
    vi.stubGlobal(`fetch`, globalFetch)
    try {
      const { createClientCredentialsProvider } = await import(
        `../src/auth/client-credentials`
      )
      const provider = createClientCredentialsProvider({
        tokenUrl: `https://x/token`,
        clientId: `cid`,
        clientSecret: `sec`,
      })
      const t1 = await provider.tokens()
      const t2 = await provider.tokens()
      expect(t1?.access_token).toBe(`AT`)
      expect(t2?.access_token).toBe(`AT`)
      expect(fetchCallCount).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it(`clientCredentials: expired token triggers re-fetch`, async () => {
    let fetchCallCount = 0
    const globalFetch = vi.fn(async () => {
      fetchCallCount += 1
      return new Response(
        JSON.stringify({
          access_token: `AT-${fetchCallCount}`,
          expires_in: 1,
          token_type: `Bearer`,
        })
      )
    })
    vi.stubGlobal(`fetch`, globalFetch)
    try {
      const { createClientCredentialsProvider } = await import(
        `../src/auth/client-credentials`
      )
      const provider = createClientCredentialsProvider({
        tokenUrl: `https://x/token`,
        clientId: `cid`,
        clientSecret: `sec`,
      })
      await provider.tokens()
      const realDateNow = Date.now
      Date.now = () => realDateNow() + 35_000
      try {
        const t2 = await provider.tokens()
        expect(t2?.access_token).toBe(`AT-2`)
        expect(fetchCallCount).toBe(2)
      } finally {
        Date.now = realDateNow
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it(`authorizationCode: finishAuth throws for an unknown server`, async () => {
    const reg = createRegistry({ publicUrl: `http://r:4448` })
    await expect(
      reg.finishAuth(`no-such-server`, `CODE`, `STATE`)
    ).rejects.toThrow(/unknown server/)
  })

  it(`authorizationCode: finishAuth throws when server has no OAuth provider`, async () => {
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({ tools: [] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    })
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    await expect(reg.finishAuth(`mock`, `CODE`, `STATE`)).rejects.toThrow(
      /no OAuth provider/
    )
  })

  it(`authorizationCode: pre-existing tokens skip the OAuth flow`, async () => {
    // Inline `auth.tokens` seeds the in-process cache; the SDK transport
    // attaches the bearer header without going through PKCE.
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({ tools: [{ name: `t`, inputSchema: {} }] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    })
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        client: { clientId: `cid` },
        tokens: {
          accessToken: `WARM`,
          refreshToken: `R`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    })
    expect(r.state).toBe(`ready`)
  })

  it(`authorizationCode: openAuthorizeUrl is invoked with the SDK-generated URL`, async () => {
    const openAuthorizeUrl = vi.fn()
    const opts: RegistryOpts = {
      publicUrl: `http://r:4448`,
      openAuthorizeUrl,
      transportFactoryOverride: (_cfg, _hp, provider) => ({
        client: {
          listTools: async () => ({ tools: [] }),
          close: async () => {},
        } as any,
        connect: async () => {
          provider!.redirectToAuthorization(
            new URL(`https://provider/authorize?x=1`)
          )
          throw new Error(`UnauthorizedError`)
        },
        close: async () => {},
      }),
    }
    const reg = createRegistry(opts)
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        client: { clientId: `cid` },
      },
    })
    expect(openAuthorizeUrl).toHaveBeenCalledTimes(1)
    expect(openAuthorizeUrl).toHaveBeenCalledWith(
      `https://provider/authorize?x=1`,
      `mock`
    )
  })

  it(`authorizationCode: onTokensChanged fires when the SDK saves tokens`, async () => {
    const onTokensChanged = vi.fn()
    const authStore = testAuthStore()
    const reg = createRegistry({ publicUrl: `http://r:4448`, authStore })
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        client: { clientId: `cid` },
        onTokensChanged,
      },
    })
    // Drive a save through the store directly — the registry registers
    // the per-server hook on addServer, so any subsequent saveOAuthTokens
    // (whether from the SDK refresh path or this synthetic call) fires it.
    await authStore.saveOAuthTokens(`mock`, {
      accessToken: `NEW`,
      refreshToken: `R2`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    expect(onTokensChanged).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: `NEW` })
    )
  })
})
