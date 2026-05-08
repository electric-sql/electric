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

  // Detects the cross-session redirect-URI drift that bites when the
  // runtime listens on a different port than the one a previously-
  // persisted DCR client was registered against. Without the guard
  // the SDK would send the new redirect_uri to a server that only
  // knows the old one, and the token exchange would fail with
  // `invalid_grant`.
  it(`authorizationCode: skips seeding when cached client.redirectUris don't match the current redirect_uri`, async () => {
    const authStore = testAuthStore()
    const reg = createRegistry({
      publicUrl: `http://r:NEW_PORT`,
      authStore,
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
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        // Cached on a previous session, when the runtime listened on
        // a different port. The DCR client registered the OLD URI.
        client: {
          clientId: `STALE`,
          redirectUris: [`http://r:OLD_PORT/oauth/callback/mock`],
        },
        tokens: {
          accessToken: `STALE`,
          refreshToken: `R`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    })
    // Stale client + tokens are dropped — the next connect triggers
    // fresh DCR + auth flow.
    expect(authStore.getOAuthClientInfo(`mock`)).toBeUndefined()
    expect(authStore.getOAuthTokens(`mock`)).toBeUndefined()
  })

  it(`authorizationCode: seeds normally when cached client.redirectUris include the current redirect_uri`, async () => {
    const authStore = testAuthStore()
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      authStore,
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
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        client: {
          clientId: `CID`,
          redirectUris: [`http://r:4448/oauth/callback/mock`],
        },
        tokens: {
          accessToken: `WARM`,
          refreshToken: `R`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    })
    expect(authStore.getOAuthClientInfo(`mock`)?.clientId).toBe(`CID`)
    expect(authStore.getOAuthTokens(`mock`)?.accessToken).toBe(`WARM`)
  })

  it(`authorizationCode: skips seeding when the cached client has no redirectUris recorded`, async () => {
    // Legacy keychain entries from before redirectUris were captured.
    // We can't tell whether the URI matches, so we conservatively
    // drop the cache and force one fresh DCR.
    const authStore = testAuthStore()
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      authStore,
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
      auth: {
        mode: `authorizationCode`,
        scopes: [`mcp:read`],
        // No `redirectUris` field — legacy data shape.
        client: { clientId: `OLD-NO-URI` },
        tokens: {
          accessToken: `STALE`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    })
    expect(authStore.getOAuthClientInfo(`mock`)).toBeUndefined()
    expect(authStore.getOAuthTokens(`mock`)).toBeUndefined()
  })
})

describe(`Registry — reauthorize`, () => {
  // Helper: a transport whose connect always triggers redirectToAuthorization
  // and throws, so the registry's connectAndList → peekAuthUrl path fires.
  const redirectingTransport: RegistryOpts[`transportFactoryOverride`] = (
    _cfg,
    _hp,
    provider
  ) => ({
    client: {
      listTools: async () => ({ tools: [] }),
      close: async () => {},
    } as any,
    connect: async () => {
      provider!.redirectToAuthorization(
        new URL(`https://provider/authorize?nonce=${Math.random()}`)
      )
      throw new Error(`UnauthorizedError`)
    },
    close: async () => {},
  })

  // Helper: a transport that always succeeds (no auth challenge).
  const happyTransport: RegistryOpts[`transportFactoryOverride`] = () => ({
    client: {
      listTools: async () => ({ tools: [] }),
      close: async () => {},
    } as any,
    connect: async () => {},
    close: async () => {},
  })

  // Helper: a transport that always throws without redirecting — drives
  // the entry to `error` so we can inspect post-reauthorize state without
  // the SDK writing new tokens behind our back.
  const failingTransport: RegistryOpts[`transportFactoryOverride`] = () => ({
    client: {
      listTools: async () => ({ tools: [] }),
      close: async () => {},
    } as any,
    connect: async () => {
      throw new Error(`boom`)
    },
    close: async () => {},
  })

  it(`is a no-op when the server is unknown`, async () => {
    const reg = createRegistry({ publicUrl: `http://r:4448` })
    await expect(reg.reauthorize(`nope`)).resolves.toBeUndefined()
    expect(reg.list()).toEqual([])
  })

  it(`is a no-op for non-authorizationCode servers`, async () => {
    const openAuthorizeUrl = vi.fn()
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      transportFactoryOverride: happyTransport,
      openAuthorizeUrl,
    })
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `k`, headerName: `X-Api-Key` },
    })
    openAuthorizeUrl.mockClear()
    await reg.reauthorize(`mock`)
    expect(openAuthorizeUrl).not.toHaveBeenCalled()
    expect(reg.list()[0]?.status).toBe(`ready`)
  })

  it(`is a no-op when the server is disabled`, async () => {
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      transportFactoryOverride: redirectingTransport,
    })
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
    await reg.disable(`mock`)
    await reg.reauthorize(`mock`)
    expect(reg.list()[0]?.status).toBe(`disabled`)
  })

  it(`clears cached tokens for the server`, async () => {
    const authStore = testAuthStore({
      tokens: {
        mock: { accessToken: `OLD`, refreshToken: `R`, expiresAt: 1 },
      },
    })
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      authStore,
      transportFactoryOverride: failingTransport,
    })
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
    expect(authStore.getOAuthTokens(`mock`)?.accessToken).toBe(`OLD`)
    await reg.reauthorize(`mock`)
    expect(authStore.getOAuthTokens(`mock`)).toBeUndefined()
  })

  it(`keeps onTokensChanged registered across reauthorize`, async () => {
    const onTokensChanged = vi.fn()
    const authStore = testAuthStore()
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      authStore,
      transportFactoryOverride: failingTransport,
    })
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
    await reg.reauthorize(`mock`)
    onTokensChanged.mockClear()
    await authStore.saveOAuthTokens(`mock`, {
      accessToken: `FRESH`,
      refreshToken: `R2`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    expect(onTokensChanged).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: `FRESH` })
    )
  })

  it(`keeps the entry in every snapshot and emits a connecting flash`, async () => {
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      transportFactoryOverride: redirectingTransport,
    })
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
    const seen: Array<{ status: string | undefined; size: number }> = []
    const off = reg.subscribe((snap) =>
      seen.push({
        status: snap.servers.find((s) => s.name === `mock`)?.status,
        size: snap.servers.length,
      })
    )
    seen.length = 0 // drop the initial sentinel
    await reg.reauthorize(`mock`)
    off()
    expect(seen.every((s) => s.size === 1)).toBe(true)
    expect(seen.map((s) => s.status)).toContain(`connecting`)
    expect(seen[seen.length - 1]?.status).toBe(`authenticating`)
  })

  it(`invokes openAuthorizeUrl with the freshly produced authorize URL`, async () => {
    const openAuthorizeUrl = vi.fn()
    const reg = createRegistry({
      publicUrl: `http://r:4448`,
      transportFactoryOverride: redirectingTransport,
      openAuthorizeUrl,
    })
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
    const initialUrl = openAuthorizeUrl.mock.calls[0]?.[0] as string
    openAuthorizeUrl.mockClear()
    await reg.reauthorize(`mock`)
    expect(openAuthorizeUrl).toHaveBeenCalledTimes(1)
    const newUrl = openAuthorizeUrl.mock.calls[0]?.[0] as string
    expect(newUrl).toContain(`authorize`)
    expect(newUrl).not.toBe(initialUrl)
  })
})
