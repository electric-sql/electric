import { describe, expect, it, vi } from 'vitest'
import { createRuntimeServerClient } from '../src/runtime-server-client'
import { createHandlerContext } from '../src/context-factory'
import { testSandboxStub } from './helpers/context-test-helpers'

describe(`runtime-server-client.setTag`, () => {
  it(`ensureStream creates an exact stream path with the requested content type`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch

    const client = createRuntimeServerClient({
      baseUrl: `http://test.example/t/tenant-a/v1`,
      fetch: fakeFetch,
    })

    await expect(
      client.ensureStream(`/_webhooks/repo/prs/123`, `application/json`)
    ).resolves.toBe(`/_webhooks/repo/prs/123`)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      `http://test.example/t/tenant-a/v1/_webhooks/repo/prs/123`
    )
    expect(calls[0]!.init?.method).toBe(`PUT`)
    expect(new Headers(calls[0]!.init?.headers).get(`content-type`)).toBe(
      `application/json`
    )
  })

  it(`ensureStream treats existing streams as success`, async () => {
    const fakeFetch = vi.fn(
      async () => new Response(`already exists`, { status: 409 })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(client.ensureStream(`/_webhooks/repo`)).resolves.toBe(
      `/_webhooks/repo`
    )
  })

  it(`ensureSharedStateStream sends the owner entity header`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.ensureSharedStateStream(`board-1`, `/task/owner`)
    ).resolves.toBe(`/_electric/shared-state/board-1`)

    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get(`content-type`)).toBe(`application/json`)
    expect(headers.get(`electric-owner-entity`)).toBe(`/task/owner`)
  })

  it(`sends POST with bearer token and tag body`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    }) as unknown as typeof fetch

    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    const result = await client.setTag(
      `/horton/abc`,
      `title`,
      `Refactor auth`,
      `wt-1234`
    )

    expect(result).toEqual({})
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      `http://test.example/_electric/entities/horton/abc/tags/title`
    )
    expect(calls[0]!.init?.method).toBe(`POST`)
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer wt-1234`)
    expect(headers.get(`content-type`)).toBe(`application/json`)
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      value: `Refactor auth`,
    })
  })

  it(`returns txid from tag response when present`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ txid: `tx-title` }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.setTag(`/horton/abc`, `title`, `Refactor auth`, `wt-1234`)
    ).resolves.toEqual({ txid: `tx-title` })
  })

  it(`coerces numeric txid from tag response to string`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ txid: 12345 }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.setTag(`/horton/abc`, `title`, `Refactor auth`, `wt-1234`)
    ).resolves.toEqual({ txid: `12345` })
  })

  it(`can keep server authorization while sending write token separately`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    }) as unknown as typeof fetch

    const client = createRuntimeServerClient({
      baseUrl: `http://test.example/t/tenant-a/v1`,
      fetch: fakeFetch,
      headers: { authorization: `Bearer tenant-token` },
      writeTokenHeader: `electric-claim-token`,
    })

    await client.setTag(`/horton/abc`, `title`, `Refactor auth`, `wt-1234`)

    expect(calls[0]!.url).toBe(
      `http://test.example/t/tenant-a/v1/_electric/entities/horton/abc/tags/title`
    )
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer tenant-token`)
    expect(headers.get(`electric-claim-token`)).toBe(`wt-1234`)
  })

  it(`returns empty object when tag response body is not valid JSON`, async () => {
    const fakeFetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.setTag(`/horton/abc`, `title`, `Refactor auth`, `wt-1234`)
    ).resolves.toEqual({})
  })

  it(`throws when the server returns a non-2xx response`, async () => {
    const fakeFetch = vi.fn(
      async () => new Response(`unauthorized`, { status: 401 })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.setTag(`/horton/abc`, `title`, `x`, `bad-token`)
    ).rejects.toThrow(/setTag.*401/)
  })
})

describe(`runtime-server-client.deleteTag`, () => {
  it(`returns empty object when no txid in response`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    const result = await client.deleteTag(`/horton/abc`, `title`, `wt-1234`)

    expect(result).toEqual({})
    expect(fakeFetch).toHaveBeenCalledWith(
      `http://test.example/_electric/entities/horton/abc/tags/title`,
      expect.objectContaining({ method: `DELETE` })
    )
  })

  it(`returns txid from deleteTag response when present`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ txid: `tx-del` }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.deleteTag(`/horton/abc`, `title`, `wt-1234`)
    ).resolves.toEqual({ txid: `tx-del` })
  })

  it(`coerces numeric txid from deleteTag response to string`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ txid: 99999 }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.deleteTag(`/horton/abc`, `title`, `wt-1234`)
    ).resolves.toEqual({ txid: `99999` })
  })

  it(`throws when the server returns a non-2xx response`, async () => {
    const fakeFetch = vi.fn(
      async () => new Response(`forbidden`, { status: 403 })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.deleteTag(`/horton/abc`, `title`, `bad-token`)
    ).rejects.toThrow(/deleteTag.*403/)
  })
})

describe(`runtime-server-client event sources`, () => {
  it(`lists event sources from the runtime server`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            eventSources: [
              {
                sourceKey: `github-repo`,
                sourceType: `webhook`,
                endpointKey: `github-repo`,
                status: `active`,
                label: `GitHub repository`,
                agentVisible: true,
                buckets: [],
                revision: 1,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': `application/json` },
          }
        )
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example/t/tenant-a/v1`,
      fetch: fakeFetch,
    })

    await expect(client.listEventSources()).resolves.toMatchObject([
      { sourceKey: `github-repo` },
    ])
    expect(fakeFetch).toHaveBeenCalledWith(
      `http://test.example/t/tenant-a/v1/_electric/event-sources`,
      expect.objectContaining({ method: `GET` })
    )
  })

  it(`subscribes to event sources with a deterministic id and JSON body`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const subscription = {
      id: `github-repo-pull-request-1kwxl2f`,
      entityUrl: `/coder/session-1`,
      sourceKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
      filterApplied: false,
      contractRevision: 1,
      sourceUrl: `/_webhooks/github-repo/prs/123`,
      sourceType: `webhook`,
      manifestKey: `event-source:github-repo-pull-request-1kwxl2f`,
      lifetime: { kind: `until_entity_stopped` },
      createdBy: `tool`,
      createdAt: `2026-05-23T00:00:00.000Z`,
    }
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ txid: `tx-1`, subscription }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    }) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.subscribeToEventSource({
        entityUrl: `/coder/session-1`,
        sourceKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        reason: `Watch PR feedback`,
      })
    ).resolves.toEqual({ txid: `tx-1`, subscription })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toMatch(
      /^http:\/\/test\.example\/_electric\/entities\/coder\/session-1\/event-source-subscriptions\/github-repo-pull_request-/
    )
    expect(calls[0]!.init?.method).toBe(`PUT`)
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      sourceKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
      reason: `Watch PR feedback`,
    })
  })

  it(`surfaces event source subscription failures`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(`invalid params`, {
          status: 400,
        })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.subscribeToEventSource({
        entityUrl: `/coder/session-1`,
        sourceKey: `github-repo`,
      })
    ).rejects.toThrow(/subscribeToEventSource failed \(400\): invalid params/)
  })
})

describe(`createHandlerContext: tags + tag mutations`, () => {
  it(`exposes tags snapshot and forwards setTag/deleteTag`, async () => {
    const calls: Array<Record<string, unknown>> = []
    const { ctx } = createHandlerContext({
      entityUrl: `/horton/x`,
      entityType: `horton`,
      epoch: 1,
      wakeOffset: `-1`,
      firstWake: true,
      tags: { title: `existing` },
      args: {},
      db: { collections: {} } as any,
      state: {},
      actions: {},
      electricTools: [],
      sandbox: testSandboxStub,
      events: [],
      writeEvent: () => {},
      wakeSession: {} as any,
      wakeEvent: { type: `inbox`, payload: `hi` } as any,
      doObserve: () => Promise.resolve({} as any),
      doSpawn: () => Promise.resolve({} as any),
      doFork: () => Promise.resolve({} as any),
      doMkdb: () => ({}) as any,
      executeSend: async () => ({ sent: true, targetUrl: `/horton/x` }),
      doSetTag: async (key, value) => {
        calls.push({ key, value })
      },
      doDeleteTag: async (key) => {
        calls.push({ key, removed: true })
      },
      doUnobserve: async () => {},
    })
    expect(ctx.tags).toEqual({ title: `existing` })
    await ctx.setTag(`title`, `new`)
    await ctx.deleteTag(`title`)
    expect(calls).toEqual([
      { key: `title`, value: `new` },
      { key: `title`, removed: true },
    ])
  })
})
