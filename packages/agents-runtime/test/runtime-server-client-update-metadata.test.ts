import { describe, expect, it, vi } from 'vitest'
import { createRuntimeServerClient } from '../src/runtime-server-client'
import { createHandlerContext } from '../src/context-factory'
import { testSandboxStub } from './helpers/context-test-helpers'

describe(`runtime-server-client.setTag`, () => {
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

    await client.setTag(`/horton/abc`, `title`, `Refactor auth`, `wt-1234`)

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
      baseUrl: `http://test.example?secret=s1`,
      fetch: fakeFetch,
      headers: { authorization: `Bearer tenant-token` },
      writeTokenHeader: `electric-claim-token`,
    })

    await client.setTag(`/horton/abc`, `title`, `Refactor auth`, `wt-1234`)

    expect(calls[0]!.url).toBe(
      `http://test.example/_electric/entities/horton/abc/tags/title?secret=s1`
    )
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer tenant-token`)
    expect(headers.get(`electric-claim-token`)).toBe(`wt-1234`)
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

describe(`createHandlerContext: tags + tag mutations`, () => {
  it(`exposes tags snapshot and forwards setTag/removeTag`, async () => {
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
      doMkdb: () => ({}) as any,
      executeSend: async () => ({ sent: true, targetUrl: `/horton/x` }),
      doSetTag: async (key, value) => {
        calls.push({ key, value })
      },
      doRemoveTag: async (key) => {
        calls.push({ key, removed: true })
      },
    })
    expect(ctx.tags).toEqual({ title: `existing` })
    await ctx.setTag(`title`, `new`)
    await ctx.removeTag(`title`)
    expect(calls).toEqual([
      { key: `title`, value: `new` },
      { key: `title`, removed: true },
    ])
  })
})
