import { describe, expect, it, vi } from 'vitest'
import { createRuntimeServerClient } from '../src/runtime-server-client'
import { createHandlerContext } from '../src/context-factory'

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
    expect(calls[0]!.url).toBe(`http://test.example/horton/abc/tags/title`)
    expect(calls[0]!.init?.method).toBe(`POST`)
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers[`authorization`] ?? headers[`Authorization`]).toBe(
      `Bearer wt-1234`
    )
    expect(headers[`content-type`] ?? headers[`Content-Type`]).toBe(
      `application/json`
    )
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      value: `Refactor auth`,
    })
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
      events: [],
      writeEvent: () => {},
      wakeSession: {} as any,
      wakeEvent: { type: `message_received`, payload: `hi` } as any,
      doObserve: () => Promise.resolve({} as any),
      doSpawn: () => Promise.resolve({} as any),
      doMkdb: () => ({}) as any,
      executeSend: () => {},
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
