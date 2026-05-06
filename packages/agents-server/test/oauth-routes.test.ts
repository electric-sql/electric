import { describe, expect, it, vi } from 'vitest'
import {
  createPendingAuthStore,
  createOAuthCoordinator,
  createInMemoryTokenCache,
  type TokenCache,
} from '@electric-ax/agents-mcp'
import {
  handleOAuthCallback,
  matchOAuthCallbackPath,
  mountOAuthRoutes,
} from '../src/oauth-routes'

interface SetupOpts {
  ttlMs?: number
}

function setup(opts: SetupOpts = {}) {
  const pending = createPendingAuthStore({ ttlMs: opts.ttlMs ?? 600_000 })
  const cache = createInMemoryTokenCache()
  const coordinator = createOAuthCoordinator({
    cache,
    doRefresh: async () => {
      throw new Error(`should not be called by callback`)
    },
  })
  return { pending, cache, coordinator }
}

function mockTokenFetch(): typeof globalThis.fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ access_token: `AT`, expires_in: 3600 }),
  })) as unknown as typeof globalThis.fetch
}

function withFetch(
  fn: typeof globalThis.fetch,
  body: () => Promise<void>
): Promise<void> {
  const orig = globalThis.fetch
  globalThis.fetch = fn
  return body().finally(() => {
    globalThis.fetch = orig
  })
}

describe(`oauth callback path matching`, () => {
  it(`extracts server segment`, () => {
    expect(matchOAuthCallbackPath(`/oauth/callback/gh`)).toEqual({
      server: `gh`,
    })
  })

  it(`decodes the server segment`, () => {
    expect(matchOAuthCallbackPath(`/oauth/callback/my%20server`)).toEqual({
      server: `my server`,
    })
  })

  it(`rejects non-callback paths`, () => {
    expect(matchOAuthCallbackPath(`/oauth/callback`)).toBeNull()
    expect(matchOAuthCallbackPath(`/oauth/callback/`)).toBeNull()
    expect(matchOAuthCallbackPath(`/oauth/callback/a/b`)).toBeNull()
    expect(matchOAuthCallbackPath(`/something/else`)).toBeNull()
  })
})

describe(`handleOAuthCallback`, () => {
  it(`exchanges code and stores token in coordinator`, async () => {
    const { pending, cache, coordinator } = setup()

    pending.put({
      state: `state-1`,
      server: `gh`,
      verifier: `v1`,
      clientId: `cid`,
      tokenUrl: `http://t/token`,
      redirectUri: `http://localhost/cb`,
    })

    await withFetch(mockTokenFetch(), async () => {
      const result = await handleOAuthCallback(
        { pending, coordinator },
        { server: `gh`, code: `the_code`, state: `state-1` }
      )
      expect(result.status).toBe(200)
      expect(result.body).toContain(`Authorization complete`)
    })

    expect(cache.get(`gh`, ``)?.accessToken).toBe(`AT`)
  })

  it(`rejects unknown state with 400`, async () => {
    const { pending, coordinator, cache } = setup()
    const result = await handleOAuthCallback(
      { pending, coordinator },
      { server: `gh`, code: `the_code`, state: `does-not-exist` }
    )
    expect(result.status).toBe(400)
    expect(result.body).toBe(`unknown state`)
    expect(cache.get(`gh`, ``)).toBeUndefined()
  })

  it(`rejects missing code with 400`, async () => {
    const { pending, coordinator } = setup()
    pending.put({
      state: `state-1`,
      server: `gh`,
      verifier: `v1`,
      clientId: `cid`,
      tokenUrl: `http://t/token`,
      redirectUri: `http://localhost/cb`,
    })
    const result = await handleOAuthCallback(
      { pending, coordinator },
      { server: `gh`, code: ``, state: `state-1` }
    )
    expect(result.status).toBe(400)
    expect(result.body).toBe(`missing code or state`)
  })

  it(`rejects missing state with 400`, async () => {
    const { pending, coordinator } = setup()
    const result = await handleOAuthCallback(
      { pending, coordinator },
      { server: `gh`, code: `the_code`, state: `` }
    )
    expect(result.status).toBe(400)
  })

  it(`reports 500 when token endpoint fails`, async () => {
    const { pending, coordinator, cache } = setup()
    pending.put({
      state: `state-1`,
      server: `gh`,
      verifier: `v1`,
      clientId: `cid`,
      tokenUrl: `http://t/token`,
      redirectUri: `http://localhost/cb`,
    })

    const failingFetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => `bad`,
    })) as unknown as typeof globalThis.fetch

    await withFetch(failingFetch, async () => {
      const result = await handleOAuthCallback(
        { pending, coordinator },
        { server: `gh`, code: `the_code`, state: `state-1` }
      )
      expect(result.status).toBe(500)
      expect(result.body).toContain(`Token exchange failed`)
    })

    expect(cache.get(`gh`, ``)).toBeUndefined()
  })

  it(`consumes pending state so reuse fails`, async () => {
    const { pending, coordinator } = setup()
    pending.put({
      state: `state-1`,
      server: `gh`,
      verifier: `v1`,
      clientId: `cid`,
      tokenUrl: `http://t/token`,
      redirectUri: `http://localhost/cb`,
    })

    await withFetch(mockTokenFetch(), async () => {
      const first = await handleOAuthCallback(
        { pending, coordinator },
        { server: `gh`, code: `the_code`, state: `state-1` }
      )
      expect(first.status).toBe(200)

      const replay = await handleOAuthCallback(
        { pending, coordinator },
        { server: `gh`, code: `the_code`, state: `state-1` }
      )
      expect(replay.status).toBe(400)
      expect(replay.body).toBe(`unknown state`)
    })
  })
})

describe(`mountOAuthRoutes`, () => {
  it(`writes a 200 plain-text response on a successful exchange`, async () => {
    const { pending, cache, coordinator } = setup()
    pending.put({
      state: `state-1`,
      server: `gh`,
      verifier: `v1`,
      clientId: `cid`,
      tokenUrl: `http://t/token`,
      redirectUri: `http://localhost/cb`,
    })

    const mount = mountOAuthRoutes({ pending, coordinator })

    const captured: {
      status?: number
      headers?: Record<string, string>
      body?: string
    } = {}
    const fakeReq = {
      method: `GET`,
      url: `/oauth/callback/gh?code=the_code&state=state-1`,
    } as any
    const fakeRes = {
      writeHead(status: number, headers: Record<string, string>) {
        captured.status = status
        captured.headers = headers
      },
      end(body: string) {
        captured.body = body
      },
    } as any

    let handled = false
    await withFetch(mockTokenFetch(), async () => {
      handled = await mount.handle(fakeReq, fakeRes)
    })

    expect(handled).toBe(true)
    expect(captured.status).toBe(200)
    expect(captured.headers?.[`content-type`]).toBe(`text/plain; charset=utf-8`)
    expect(captured.body).toContain(`Authorization complete`)
    expect((cache as TokenCache).get(`gh`, ``)?.accessToken).toBe(`AT`)
  })

  it(`returns false (does not handle) for non-matching paths`, async () => {
    const { pending, coordinator } = setup()
    const mount = mountOAuthRoutes({ pending, coordinator })

    let endCalled = false
    const fakeReq = { method: `GET`, url: `/something/else` } as any
    const fakeRes = {
      writeHead() {
        throw new Error(`should not write`)
      },
      end() {
        endCalled = true
      },
    } as any

    const handled = await mount.handle(fakeReq, fakeRes)
    expect(handled).toBe(false)
    expect(endCalled).toBe(false)
  })

  it(`returns false for non-GET methods`, async () => {
    const { pending, coordinator } = setup()
    const mount = mountOAuthRoutes({ pending, coordinator })

    const fakeReq = {
      method: `POST`,
      url: `/oauth/callback/gh?code=x&state=y`,
    } as any
    const fakeRes = {
      writeHead() {
        throw new Error(`should not write`)
      },
      end() {},
    } as any

    const handled = await mount.handle(fakeReq, fakeRes)
    expect(handled).toBe(false)
  })
})
