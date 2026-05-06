import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  createPendingAuthStore,
  createOAuthCoordinator,
  createInMemoryTokenCache,
  type TokenCache,
} from '@electric-ax/agents-mcp'
import {
  handleDeviceFlowRequest,
  handleDeviceFlowStart,
  handleDeviceFlowStatus,
  handleOAuthCallback,
  handleOAuthInitiate,
  handleOAuthInitiateRequest,
  matchDeviceFlowStartPath,
  matchDeviceFlowStatusPath,
  matchOAuthCallbackPath,
  matchOAuthInitiatePath,
  mountOAuthRoutes,
  _resetDeviceFlowState,
  type DeviceFlowDeps,
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

describe(`oauth initiate path matching`, () => {
  it(`extracts server segment`, () => {
    expect(matchOAuthInitiatePath(`/api/mcp/servers/gh/authorize`)).toEqual({
      server: `gh`,
    })
  })

  it(`decodes the server segment`, () => {
    expect(
      matchOAuthInitiatePath(`/api/mcp/servers/my%20server/authorize`)
    ).toEqual({ server: `my server` })
  })

  it(`rejects non-initiate paths`, () => {
    expect(matchOAuthInitiatePath(`/api/mcp/servers/authorize`)).toBeNull()
    expect(matchOAuthInitiatePath(`/api/mcp/servers//authorize`)).toBeNull()
    expect(matchOAuthInitiatePath(`/api/mcp/servers/gh`)).toBeNull()
    expect(matchOAuthInitiatePath(`/api/mcp/servers/gh/authorize/x`)).toBeNull()
    expect(matchOAuthInitiatePath(`/oauth/callback/gh`)).toBeNull()
  })
})

describe(`oauth initiate`, () => {
  it(`builds auth URL and stores pending state`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const result = await handleOAuthInitiate(
      { pending },
      {
        server: `gh`,
        authorizationUrl: `https://example.com/authorize`,
        tokenUrl: `https://example.com/token`,
        clientId: `cid`,
        redirectUri: `http://localhost/cb`,
        scopes: [`repo`],
      }
    )
    expect(result.status).toBe(200)
    const body = result.body as { url: string }
    expect(body.url).toMatch(/state=/)

    const u = new URL(body.url)
    expect(u.searchParams.get(`response_type`)).toBe(`code`)
    expect(u.searchParams.get(`client_id`)).toBe(`cid`)
    expect(u.searchParams.get(`redirect_uri`)).toBe(`http://localhost/cb`)
    expect(u.searchParams.get(`scope`)).toBe(`repo`)
    expect(u.searchParams.get(`code_challenge_method`)).toBe(`S256`)

    const state = u.searchParams.get(`state`)
    expect(state).toBeTruthy()
    const got = pending.consume(state!)
    expect(got?.server).toBe(`gh`)
    expect(got?.tokenUrl).toBe(`https://example.com/token`)
    expect(got?.clientId).toBe(`cid`)
    expect(got?.redirectUri).toBe(`http://localhost/cb`)
    expect(got?.verifier).toBeTruthy()
  })

  it(`rejects missing fields`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const result = await handleOAuthInitiate(
      { pending },
      {
        server: ``,
        authorizationUrl: ``,
        tokenUrl: ``,
        clientId: ``,
        redirectUri: ``,
      }
    )
    expect(result.status).toBe(400)
    expect((result.body as { error: string }).error).toBe(
      `missing required fields`
    )
  })

  it(`rejects when individual required fields are missing`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const base = {
      server: `gh`,
      authorizationUrl: `https://example.com/authorize`,
      tokenUrl: `https://example.com/token`,
      clientId: `cid`,
      redirectUri: `http://localhost/cb`,
    }
    for (const key of [
      `authorizationUrl`,
      `tokenUrl`,
      `clientId`,
      `redirectUri`,
    ] as const) {
      const result = await handleOAuthInitiate(
        { pending },
        { ...base, [key]: `` }
      )
      expect(result.status).toBe(400)
    }
  })
})

describe(`handleOAuthInitiateRequest`, () => {
  function fakeReqWithBody(
    method: string,
    url: string,
    body: string | undefined
  ): IncomingMessage {
    const chunks = body === undefined ? [] : [Buffer.from(body, `utf-8`)]
    async function* gen() {
      for (const c of chunks) yield c
    }
    const iter = gen()
    return {
      method,
      url,
      [Symbol.asyncIterator]: () => iter,
    } as unknown as IncomingMessage
  }

  function fakeRes(): {
    res: ServerResponse
    captured: {
      status?: number
      headers?: Record<string, string>
      body?: string
    }
  } {
    const captured: {
      status?: number
      headers?: Record<string, string>
      body?: string
    } = {}
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        captured.status = status
        captured.headers = headers
      },
      end(body: string) {
        captured.body = body
      },
    } as unknown as ServerResponse
    return { res, captured }
  }

  it(`returns false for non-POST methods`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const req = fakeReqWithBody(
      `GET`,
      `/api/mcp/servers/gh/authorize`,
      undefined
    )
    const { res, captured } = fakeRes()
    const handled = await handleOAuthInitiateRequest({ pending }, req, res)
    expect(handled).toBe(false)
    expect(captured.status).toBeUndefined()
  })

  it(`returns false for non-matching paths`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const req = fakeReqWithBody(`POST`, `/something/else`, `{}`)
    const { res, captured } = fakeRes()
    const handled = await handleOAuthInitiateRequest({ pending }, req, res)
    expect(handled).toBe(false)
    expect(captured.status).toBeUndefined()
  })

  it(`writes a 200 JSON response with the auth URL on success`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const body = JSON.stringify({
      authorizationUrl: `https://example.com/authorize`,
      tokenUrl: `https://example.com/token`,
      clientId: `cid`,
      redirectUri: `http://localhost/cb`,
      scopes: [`repo`],
    })
    const req = fakeReqWithBody(`POST`, `/api/mcp/servers/gh/authorize`, body)
    const { res, captured } = fakeRes()
    const handled = await handleOAuthInitiateRequest({ pending }, req, res)
    expect(handled).toBe(true)
    expect(captured.status).toBe(200)
    expect(captured.headers?.[`content-type`]).toBe(
      `application/json; charset=utf-8`
    )
    const parsed = JSON.parse(captured.body!) as { url: string }
    expect(parsed.url).toMatch(/state=/)
    const state = new URL(parsed.url).searchParams.get(`state`)!
    expect(pending.consume(state)?.server).toBe(`gh`)
  })

  it(`writes 400 for invalid JSON`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const req = fakeReqWithBody(
      `POST`,
      `/api/mcp/servers/gh/authorize`,
      `not json`
    )
    const { res, captured } = fakeRes()
    const handled = await handleOAuthInitiateRequest({ pending }, req, res)
    expect(handled).toBe(true)
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body!).error).toBe(`invalid JSON body`)
  })

  it(`writes 400 when body is not an object`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const req = fakeReqWithBody(
      `POST`,
      `/api/mcp/servers/gh/authorize`,
      `"just a string"`
    )
    const { res, captured } = fakeRes()
    const handled = await handleOAuthInitiateRequest({ pending }, req, res)
    expect(handled).toBe(true)
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body!).error).toBe(
      `request body must be a JSON object`
    )
  })

  it(`writes 400 when required fields are missing`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const req = fakeReqWithBody(
      `POST`,
      `/api/mcp/servers/gh/authorize`,
      JSON.stringify({ clientId: `cid` })
    )
    const { res, captured } = fakeRes()
    const handled = await handleOAuthInitiateRequest({ pending }, req, res)
    expect(handled).toBe(true)
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body!).error).toBe(`missing required fields`)
  })
})

describe(`mountOAuthRoutes initiate dispatch`, () => {
  it(`routes POST /api/mcp/servers/:server/authorize to the initiate handler`, async () => {
    const pending = createPendingAuthStore({ ttlMs: 600_000 })
    const cache = createInMemoryTokenCache()
    const coordinator = createOAuthCoordinator({
      cache,
      doRefresh: async () => {
        throw new Error(`should not be called`)
      },
    })
    const mount = mountOAuthRoutes({ pending, coordinator })

    async function* gen() {
      yield Buffer.from(
        JSON.stringify({
          authorizationUrl: `https://example.com/authorize`,
          tokenUrl: `https://example.com/token`,
          clientId: `cid`,
          redirectUri: `http://localhost/cb`,
        }),
        `utf-8`
      )
    }
    const iter = gen()
    const fakeReq = {
      method: `POST`,
      url: `/api/mcp/servers/gh/authorize`,
      [Symbol.asyncIterator]: () => iter,
    } as any

    const captured: {
      status?: number
      headers?: Record<string, string>
      body?: string
    } = {}
    const fakeResObj = {
      writeHead(status: number, headers: Record<string, string>) {
        captured.status = status
        captured.headers = headers
      },
      end(body: string) {
        captured.body = body
      },
    } as any

    const handled = await mount.handle(fakeReq, fakeResObj)
    expect(handled).toBe(true)
    expect(captured.status).toBe(200)
    const url = JSON.parse(captured.body!).url as string
    expect(url).toMatch(/state=/)
    const state = new URL(url).searchParams.get(`state`)!
    expect(pending.consume(state)?.server).toBe(`gh`)
  })
})

describe(`device flow path matching`, () => {
  it(`matches the start path`, () => {
    expect(matchDeviceFlowStartPath(`/oauth/device/gh/start`)).toEqual({
      server: `gh`,
    })
    expect(matchDeviceFlowStartPath(`/oauth/device/my%20s/start`)).toEqual({
      server: `my s`,
    })
  })

  it(`matches the status path`, () => {
    expect(matchDeviceFlowStatusPath(`/oauth/device/gh/status`)).toEqual({
      server: `gh`,
    })
  })

  it(`rejects unrelated paths`, () => {
    expect(matchDeviceFlowStartPath(`/oauth/device/gh/status`)).toBeNull()
    expect(matchDeviceFlowStatusPath(`/oauth/device/gh/start`)).toBeNull()
    expect(matchDeviceFlowStartPath(`/oauth/callback/gh`)).toBeNull()
  })
})

/**
 * Build a fetch double that walks a script of canned responses, one per
 * call. Each entry is either a `device-auth` start payload or a
 * `token-poll` payload. Anything off-script throws so accidental extra
 * calls fail loudly.
 */
function scriptedFetch(
  steps: Array<
    | {
        kind: `device-auth`
        body: Record<string, unknown>
        ok?: boolean
        status?: number
      }
    | {
        kind: `token-poll`
        body: Record<string, unknown>
        ok?: boolean
        status?: number
      }
  >
): typeof globalThis.fetch {
  let i = 0
  return (async () => {
    const step = steps[i++]
    if (!step) throw new Error(`scriptedFetch: out of steps`)
    return {
      ok: step.ok ?? true,
      status: step.status ?? 200,
      json: async () => step.body,
      text: async () => JSON.stringify(step.body),
    }
  }) as unknown as typeof globalThis.fetch
}

function makeDeviceDeps(lookup: DeviceFlowDeps[`lookup`]): {
  deps: DeviceFlowDeps
  cache: TokenCache
} {
  const cache = createInMemoryTokenCache()
  const coordinator = createOAuthCoordinator({
    cache,
    doRefresh: async () => {
      throw new Error(`should not refresh`)
    },
  })
  return { deps: { coordinator, lookup }, cache }
}

describe(`handleDeviceFlowStart`, () => {
  it(`returns 404 when lookup yields null`, async () => {
    _resetDeviceFlowState()
    const { deps } = makeDeviceDeps(async () => null)
    const out = await handleDeviceFlowStart(deps, `unknown`)
    expect(out.status).toBe(404)
    expect((out.body as { error: string }).error).toMatch(/not found/)
  })

  it(`starts the flow, returns user code, and stores token on poll success`, async () => {
    _resetDeviceFlowState()
    const { deps, cache } = makeDeviceDeps(async () => ({
      deviceAuthorizationUrl: `http://x/device`,
      tokenUrl: `http://x/token`,
      clientId: `cid`,
      scopes: [`repo`],
    }))
    const fetchScript = scriptedFetch([
      {
        kind: `device-auth`,
        body: {
          device_code: `dc`,
          user_code: `WDJB-MJHT`,
          verification_uri: `https://example.com/device`,
          verification_uri_complete: `https://example.com/device?user_code=WDJB-MJHT`,
          interval: 0,
          expires_in: 600,
        },
      },
      {
        kind: `token-poll`,
        body: { access_token: `AT`, expires_in: 3600 },
      },
    ])

    let out: { status: number; body: unknown } | undefined
    await withFetch(fetchScript, async () => {
      out = await handleDeviceFlowStart(deps, `gh`)
      // Allow the fire-and-forget poll promise to settle.
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(out?.status).toBe(200)
    const body = out!.body as {
      status: string
      userCode: string
      verificationUri: string
      verificationUriComplete?: string
      expiresAt: string
    }
    expect(body.status).toBe(`pending`)
    expect(body.userCode).toBe(`WDJB-MJHT`)
    expect(body.verificationUri).toBe(`https://example.com/device`)
    expect(body.verificationUriComplete).toBe(
      `https://example.com/device?user_code=WDJB-MJHT`
    )

    // Coordinator should have the token under the requested scopes.
    // The coordinator stores under the sorted-joined scope key.
    expect(cache.get(`gh`, `repo`)?.accessToken).toBe(`AT`)

    // Status should now report completed.
    const status = handleDeviceFlowStatus(null, `gh`)
    expect((status.body as { status: string }).status).toBe(`completed`)
  })

  it(`reports failed status when the polling errors out`, async () => {
    _resetDeviceFlowState()
    const { deps } = makeDeviceDeps(async () => ({
      deviceAuthorizationUrl: `http://x/device`,
      tokenUrl: `http://x/token`,
      clientId: `cid`,
    }))
    const fetchScript = scriptedFetch([
      {
        kind: `device-auth`,
        body: {
          device_code: `dc`,
          user_code: `UC`,
          verification_uri: `https://example.com/device`,
          interval: 0,
          expires_in: 600,
        },
      },
      {
        kind: `token-poll`,
        ok: false,
        status: 400,
        body: { error: `access_denied`, error_description: `user denied` },
      },
    ])

    await withFetch(fetchScript, async () => {
      const out = await handleDeviceFlowStart(deps, `gh`)
      expect(out.status).toBe(200)
      // Allow the polling promise to reject and update state.
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    })

    const status = handleDeviceFlowStatus(null, `gh`)
    const body = status.body as { status: string; error?: string }
    expect(body.status).toBe(`failed`)
    expect(body.error).toMatch(/user denied|access_denied/)
  })

  it(`reuses the existing pending state on a duplicate start`, async () => {
    _resetDeviceFlowState()
    let lookups = 0
    const { deps } = makeDeviceDeps(async () => {
      lookups++
      return {
        deviceAuthorizationUrl: `http://x/device`,
        tokenUrl: `http://x/token`,
        clientId: `cid`,
      }
    })
    // Token-poll never resolves within this test (interval ticks until
    // expiry, but we never advance time), so the flow stays `pending`.
    const fetchScript = scriptedFetch([
      {
        kind: `device-auth`,
        body: {
          device_code: `dc`,
          user_code: `UC1`,
          verification_uri: `https://example.com/device`,
          interval: 60,
          expires_in: 600,
        },
      },
    ])

    await withFetch(fetchScript, async () => {
      const first = await handleDeviceFlowStart(deps, `gh`)
      const second = await handleDeviceFlowStart(deps, `gh`)
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      const a = first.body as { userCode: string }
      const b = second.body as { userCode: string; status: string }
      expect(b.userCode).toBe(a.userCode)
      expect(b.status).toBe(`pending`)
      expect(lookups).toBe(1)
    })
  })

  it(`returns 502 when the device authorization endpoint fails`, async () => {
    _resetDeviceFlowState()
    const { deps } = makeDeviceDeps(async () => ({
      deviceAuthorizationUrl: `http://x/device`,
      tokenUrl: `http://x/token`,
      clientId: `cid`,
    }))
    const fetchScript = scriptedFetch([
      {
        kind: `device-auth`,
        ok: false,
        status: 500,
        body: { error: `server_error` },
      },
    ])

    await withFetch(fetchScript, async () => {
      const out = await handleDeviceFlowStart(deps, `gh`)
      expect(out.status).toBe(502)
      expect((out.body as { error: string }).error).toMatch(
        /device authorization failed/
      )
    })
  })
})

describe(`handleDeviceFlowStatus`, () => {
  it(`returns idle when no flow has been started`, () => {
    _resetDeviceFlowState()
    const out = handleDeviceFlowStatus(null, `none`)
    expect(out.status).toBe(200)
    expect((out.body as { status: string }).status).toBe(`idle`)
  })
})

describe(`handleDeviceFlowRequest`, () => {
  function fakeReq(method: string, url: string): IncomingMessage {
    return { method, url } as unknown as IncomingMessage
  }
  function fakeRes(): {
    res: ServerResponse
    captured: { status?: number; body?: string }
  } {
    const captured: { status?: number; body?: string } = {}
    const res = {
      writeHead(status: number) {
        captured.status = status
      },
      end(body: string) {
        captured.body = body
      },
    } as unknown as ServerResponse
    return { res, captured }
  }

  it(`dispatches GET status to the status handler`, async () => {
    _resetDeviceFlowState()
    const { deps } = makeDeviceDeps(async () => null)
    const { res, captured } = fakeRes()
    const handled = await handleDeviceFlowRequest(
      deps,
      fakeReq(`GET`, `/oauth/device/gh/status`),
      res
    )
    expect(handled).toBe(true)
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body!).status).toBe(`idle`)
  })

  it(`dispatches POST start to the start handler`, async () => {
    _resetDeviceFlowState()
    const { deps } = makeDeviceDeps(async () => null)
    const { res, captured } = fakeRes()
    const handled = await handleDeviceFlowRequest(
      deps,
      fakeReq(`POST`, `/oauth/device/gh/start`),
      res
    )
    expect(handled).toBe(true)
    expect(captured.status).toBe(404)
  })

  it(`returns false for unrelated paths`, async () => {
    _resetDeviceFlowState()
    const { deps } = makeDeviceDeps(async () => null)
    const { res } = fakeRes()
    const handled = await handleDeviceFlowRequest(
      deps,
      fakeReq(`GET`, `/something/else`),
      res
    )
    expect(handled).toBe(false)
  })
})

describe(`mountOAuthRoutes device flow dispatch`, () => {
  it(`only routes device endpoints when deviceLookup is provided`, async () => {
    _resetDeviceFlowState()
    const { pending, coordinator } = setup()
    const mountWithoutDevice = mountOAuthRoutes({ pending, coordinator })

    let handled = await mountWithoutDevice.handle(
      { method: `POST`, url: `/oauth/device/gh/start` } as any,
      {
        writeHead() {
          throw new Error(`should not write`)
        },
        end() {},
      } as any
    )
    expect(handled).toBe(false)

    const mountWithDevice = mountOAuthRoutes(
      { pending, coordinator },
      undefined,
      async () => null
    )
    const captured: { status?: number; body?: string } = {}
    handled = await mountWithDevice.handle(
      { method: `GET`, url: `/oauth/device/gh/status` } as any,
      {
        writeHead(s: number) {
          captured.status = s
        },
        end(b: string) {
          captured.body = b
        },
      } as any
    )
    expect(handled).toBe(true)
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body!).status).toBe(`idle`)
  })
})
