import { describe, expect, it, vi } from 'vitest'
import { createRuntimeServerClient } from '../src/runtime-server-client'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': `application/json` },
    ...init,
  })
}

describe(`runtime-server-client.registerPgSyncSource`, () => {
  it(`posts options to the pg-sync register route and parses the response`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({
        sourceRef: `pg_sync_abc123`,
        streamUrl: `/_electric/pg-sync/pg_sync_abc123`,
      })
    }) as unknown as typeof fetch

    const client = createRuntimeServerClient({
      baseUrl: `http://test.example?secret=s1`,
      fetch: fakeFetch,
    })

    const options = {
      url: `http://localhost:30000/v1/shape`,
      table: `todos`,
      columns: [`id`, `text`],
      where: `priority = $1`,
      params: [`high`],
      replica: `full` as const,
    }

    await expect(client.registerPgSyncSource(options)).resolves.toEqual({
      sourceRef: `pg_sync_abc123`,
      streamUrl: `/_electric/pg-sync/pg_sync_abc123`,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      `http://test.example/_electric/pg-sync/register?secret=s1`
    )
    expect(calls[0]!.init?.method).toBe(`POST`)
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get(`content-type`)).toBe(`application/json`)
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ options })
  })

  it(`throws a useful error for non-OK responses`, async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(`bad table`, { status: 400, statusText: `Bad Request` })
    ) as unknown as typeof fetch
    const client = createRuntimeServerClient({
      baseUrl: `http://test.example`,
      fetch: fakeFetch,
    })

    await expect(
      client.registerPgSyncSource({
        url: `http://localhost:30000/v1/shape`,
        table: `todos`,
      })
    ).rejects.toThrow(/registerPgSyncSource failed \(400\): bad table/)
  })
})
