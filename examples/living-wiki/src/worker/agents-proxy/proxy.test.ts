import { describe, expect, it } from 'vitest'
import type { WorkerEnv } from '../env'
import { proxyAgentsStreamRequest, AgentsProxyConfigError } from './proxy'
import type { AgentsProxyTarget } from './targets'

const secretToken = `super-secret-token`
const env: WorkerEnv = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://cloud.example`,
  ELECTRIC_AGENTS_SPACE_ID: `space`,
  ELECTRIC_AGENTS_BASE_URL: `https://agents.example/base/`,
  ELECTRIC_AGENTS_TOKEN: secretToken,
  ELECTRIC_AGENTS_PRINCIPAL_KEY: `server-principal`,
}

function fetchRecorder(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return response
  }
  return { calls, fetchImpl }
}

describe(`agents proxy adapter`, () => {
  it(`proxies shared-state stream with exact path/query and injected server auth`, async () => {
    const { calls, fetchImpl } = fetchRecorder(new Response(`ok`))
    const request = new Request(
      `https://app.test/api/observe/wiki_demo/shared-state?offset=10&live=long-poll&cursor=abc&table=evil&where=evil&secret=evil&path=/evil&unknown=evil&live=sse`,
      {
        headers: {
          authorization: `Bearer browser`,
          cookie: `sid=browser`,
          'electric-principal': `browser`,
        },
      }
    )

    await proxyAgentsStreamRequest({
      request,
      env,
      target: {
        kind: `shared-state-observe`,
        sharedStateId: `id`,
        streamPath: `/_electric/shared-state/id`,
      },
      fetchImpl,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      `https://agents.example/base/_electric/shared-state/id?offset=10&live=long-poll&cursor=abc`
    )
    expect(calls[0].init?.method).toBe(`GET`)
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer ${secretToken}`)
    expect(headers.get(`electric-principal`)).toBe(`server-principal`)
    expect(headers.has(`cookie`)).toBe(false)
    expect(headers.has(`electric-claim-token`)).toBe(false)
  })

  it(`sanitizes stream response headers and preserves status/body`, async () => {
    const { fetchImpl } = fetchRecorder(
      new Response(`stream-body`, {
        status: 206,
        statusText: `Partial`,
        headers: {
          'content-encoding': `gzip`,
          'content-length': `99`,
          'stream-next-offset': `11`,
        },
      })
    )

    const response = await proxyAgentsStreamRequest({
      request: new Request(`https://app.test/?offset=1`),
      env,
      target: {
        kind: `shared-state-observe`,
        sharedStateId: `id`,
        streamPath: `/stream`,
      },
      fetchImpl,
    })

    expect(response.status).toBe(206)
    expect(response.statusText).toBe(`Partial`)
    expect(await response.text()).toBe(`stream-body`)
    expect(response.headers.has(`content-encoding`)).toBe(false)
    expect(response.headers.has(`content-length`)).toBe(false)
    expect(response.headers.get(`stream-next-offset`)).toBe(`11`)
    expect(response.headers.get(`access-control-expose-headers`)).toContain(
      `Stream-Next-Offset`
    )
  })

  it(`looks up entity metadata, rejects invalid main stream paths, and proxies valid path`, async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input))
      if (calls.length === 1)
        return Response.json({ streams: { main: `https://evil.test/stream` } })
      return new Response(`never`)
    }
    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env,
        target: {
          kind: `entity-main-stream-via-metadata`,
          entityType: `wiki-space`,
          instanceId: `id`,
          metadataPath: `/_electric/entities/wiki-space/id`,
        },
        fetchImpl,
      })
    ).rejects.toThrow(/invalid upstream stream path/i)

    const validCalls: string[] = []
    const validFetch: typeof fetch = async (input) => {
      validCalls.push(String(input))
      return validCalls.length === 1
        ? Response.json({ streams: { main: `/wiki-space/id/main` } })
        : new Response(`entity`)
    }
    const res = await proxyAgentsStreamRequest({
      request: new Request(`https://app.test/?cursor=c`),
      env,
      target: {
        kind: `entity-main-stream-via-metadata`,
        entityType: `wiki-space`,
        instanceId: `id`,
        metadataPath: `/_electric/entities/wiki-space/id`,
      },
      fetchImpl: validFetch,
    })
    expect(validCalls).toEqual([
      `https://agents.example/base/_electric/entities/wiki-space/id`,
      `https://agents.example/base/wiki-space/id/main?cursor=c`,
    ])
    expect(await res.text()).toBe(`entity`)
  })

  it(`ensures entities observation with server tags and proxies valid streamUrl only`, async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return calls.length === 1
        ? Response.json({ streamUrl: `/observations/wiki` })
        : new Response(`entities`)
    }
    const target: AgentsProxyTarget = {
      kind: `entities-observe-via-ensure`,
      ensurePath: `/_electric/observations/entities/ensure-stream`,
      ensureBody: { tags: { wiki_space_id: `wiki_demo` } },
    }
    const res = await proxyAgentsStreamRequest({
      request: new Request(`https://app.test/?offset=2&table=evil`),
      env,
      target,
      fetchImpl,
    })
    expect(calls[0].url).toBe(
      `https://agents.example/base/_electric/observations/entities/ensure-stream`
    )
    expect(calls[0].init?.method).toBe(`POST`)
    expect(calls[0].init?.body).toBe(
      JSON.stringify({ tags: { wiki_space_id: `wiki_demo` } })
    )
    expect(new Headers(calls[0].init?.headers).get(`content-type`)).toBe(
      `application/json`
    )
    expect(calls[1].url).toBe(
      `https://agents.example/base/observations/wiki?offset=2`
    )
    expect(await res.text()).toBe(`entities`)
  })

  it(`rejects plain and encoded traversal paths from metadata and ensure responses`, async () => {
    const traversalPaths = [
      `/../admin`,
      `/foo/../../admin`,
      `/%2e%2e/admin`,
      `/%2E%2e/admin`,
      `/foo%2f..%2fadmin`,
      `/foo%2F..%2Fadmin`,
      `/foo%5c..%5cadmin`,
    ]

    for (const streamPath of traversalPaths) {
      await expect(
        proxyAgentsStreamRequest({
          request: new Request(`https://app.test/`),
          env,
          target: {
            kind: `entity-main-stream-via-metadata`,
            entityType: `wiki-space`,
            instanceId: `id`,
            metadataPath: `/_electric/entities/wiki-space/id`,
          },
          fetchImpl: async () =>
            Response.json({ streams: { main: streamPath } }),
        })
      ).rejects.toThrow(/invalid upstream stream path/i)

      await expect(
        proxyAgentsStreamRequest({
          request: new Request(`https://app.test/`),
          env,
          target: {
            kind: `entities-observe-via-ensure`,
            ensurePath: `/_electric/observations/entities/ensure-stream`,
            ensureBody: { tags: { wiki_space_id: `wiki` } },
          },
          fetchImpl: async () => Response.json({ streamUrl: streamPath }),
        })
      ).rejects.toThrow(/invalid upstream stream path/i)
    }
  })

  it(`preserves configured base path when joining upstream paths`, async () => {
    const runtimeEnv = {
      ...env,
      ELECTRIC_AGENTS_BASE_URL: `https://agents.example/runtime`,
    }
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input))
      return new Response(`ok`)
    }

    await proxyAgentsStreamRequest({
      request: new Request(`https://app.test/`),
      env: runtimeEnv,
      target: {
        kind: `shared-state-observe`,
        sharedStateId: `id`,
        streamPath: `/shared`,
      },
      fetchImpl,
    })

    expect(calls[0]).toBe(`https://agents.example/runtime/shared`)
    expect(calls[0]).not.toBe(`https://agents.example/shared`)

    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env: runtimeEnv,
        target: {
          kind: `shared-state-observe`,
          sharedStateId: `id`,
          streamPath: `/../shared`,
        },
        fetchImpl,
      })
    ).rejects.toThrow(/invalid upstream stream path/i)
  })

  it(`rejects non-OK metadata and ensure JSON responses before trusting paths`, async () => {
    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env,
        target: {
          kind: `entity-main-stream-via-metadata`,
          entityType: `wiki-space`,
          instanceId: `id`,
          metadataPath: `/_electric/entities/wiki-space/id`,
        },
        fetchImpl: async () =>
          Response.json({ streams: { main: `/valid` } }, { status: 500 }),
      })
    ).rejects.toThrow(/invalid upstream entity metadata response/i)

    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env,
        target: {
          kind: `entities-observe-via-ensure`,
          ensurePath: `/_electric/observations/entities/ensure-stream`,
          ensureBody: { tags: { wiki_space_id: `wiki` } },
        },
        fetchImpl: async () =>
          Response.json({ streamUrl: `/valid` }, { status: 500 }),
      })
    ).rejects.toThrow(/invalid upstream ensure response/i)
  })

  it(`does not consume stream body before returning response`, async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    const fetchImpl: typeof fetch = async () => new Response(body)

    const response = await proxyAgentsStreamRequest({
      request: new Request(`https://app.test/`),
      env,
      target: {
        kind: `shared-state-observe`,
        sharedStateId: `id`,
        streamPath: `/stream`,
      },
      fetchImpl,
    })

    controller?.enqueue(new TextEncoder().encode(`streamed`))
    controller?.close()
    expect(await response.text()).toBe(`streamed`)
  })

  it(`rejects invalid ensure streamUrl and adapter errors do not leak secrets`, async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ streamUrl: `//evil.test/path` })
    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env,
        target: {
          kind: `entities-observe-via-ensure`,
          ensurePath: `/_electric/observations/entities/ensure-stream`,
          ensureBody: { tags: { wiki_space_id: `wiki` } },
        },
        fetchImpl,
      })
    ).rejects.toThrow(/invalid upstream stream path/i)

    const badEnv = { ...env, ELECTRIC_AGENTS_BASE_URL: undefined }
    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env: badEnv,
        target: {
          kind: `shared-state-observe`,
          sharedStateId: `id`,
          streamPath: `/stream`,
        },
        fetchImpl,
      })
    ).rejects.toThrow(AgentsProxyConfigError)
    await expect(
      proxyAgentsStreamRequest({
        request: new Request(`https://app.test/`),
        env: badEnv,
        target: {
          kind: `shared-state-observe`,
          sharedStateId: `id`,
          streamPath: `/stream`,
        },
        fetchImpl,
      })
    ).rejects.not.toThrow(secretToken)
  })
})
