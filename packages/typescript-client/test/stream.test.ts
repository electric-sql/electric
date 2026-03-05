import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream, isChangeMessage, Message, Row } from '../src'
import { snakeCamelMapper } from '../src/column-mapper'
import { resolveInMacrotask } from './support/test-helpers'

describe(`ShapeStream`, () => {
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController

  beforeEach(() => {
    aborter = new AbortController()
  })

  afterEach(() => aborter.abort())

  it(`should attach specified headers to requests`, async () => {
    const eventTarget = new EventTarget()
    const requestArgs: Array<RequestInit | undefined> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestArgs.push(args[1])
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      headers: {
        Authorization: `my-token`,
        'X-Custom-Header': `my-value`,
      },
    })
    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestArgs[0]).toMatchObject({
      headers: {
        Authorization: `my-token`,
        'X-Custom-Header': `my-value`,
      },
    })
  })

  it(`should sort query parameters for stable URLs`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=1`,
        columns: [`id`],
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=%22id%22&handle=potato&log=full&offset=-1&table=foo&where=a%3D1`
    )
  })

  it(`should start requesting only after first subscription`, async () => {
    const eventTarget = new EventTarget()
    const fetchWrapper = (): Promise<Response> => {
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=1`,
        columns: [`id`],
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    // should not fire any fetch requests
    await new Promise<void>((resolve, reject) => {
      eventTarget.addEventListener(`fetch`, reject, { once: true })
      setTimeout(() => resolve(), 100)
    })

    // should fire fetch immediately after subbing
    const startedStreaming = new Promise<void>((resolve, reject) => {
      eventTarget.addEventListener(`fetch`, () => resolve(), {
        once: true,
      })
      setTimeout(() => reject(`timed out`), 100)
    })
    const unsub = stream.subscribe(() => unsub())
    await startedStreaming
  })

  it(`should correctly serialize objects into query params`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=$1 and b=$2`,
        columns: [`id`],
        params: {
          '1': `test1`,
          '2': `test2`,
        },
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=%22id%22&handle=potato&log=full&offset=-1&params%5B1%5D=test1&params%5B2%5D=test2&table=foo&where=a%3D%241+and+b%3D%242`
    )
  })

  it(`should correctly serialize where clause param array to query params`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=$1 and b=$2`,
        columns: [`id`],
        params: [`test1`, `test2`],
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=%22id%22&handle=potato&log=full&offset=-1&params%5B1%5D=test1&params%5B2%5D=test2&table=foo&where=a%3D%241+and+b%3D%242`
    )
  })

  it(`should encode columns with columnMapper`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`userId`, `createdAt`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      columnMapper: snakeCamelMapper(),
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // columns should be encoded from app format (camelCase) to db format (snake_case)
    // and quoted for safe serialization
    expect(url.searchParams.get(`columns`)).toEqual(`"user_id","created_at"`)
  })

  it(`should encode where clause with columnMapper`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `userId = $1`,
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      columnMapper: snakeCamelMapper(),
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // where clause should be encoded from app format (camelCase) to db format (snake_case)
    expect(url.searchParams.get(`where`)).toEqual(`user_id = $1`)
  })

  it(`should quote columns even when columnMapper is not provided`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`user_id`, `created_at`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // columns should be quoted for safe serialization
    expect(url.searchParams.get(`columns`)).toEqual(`"user_id","created_at"`)
  })

  it(`should handle columns with special characters`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`normal`, `has,comma`, `has"quote`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // columns with special characters should be properly quoted and escaped
    expect(url.searchParams.get(`columns`)).toEqual(
      `"normal","has,comma","has""quote"`
    )
  })

  it(`should decode data columns with columnMapper`, async () => {
    const receivedMessages: Message<Row>[] = []

    // Mock response with db column names (snake_case)
    const mockResponseData = [
      {
        key: `"public"."test"/"1"`,
        value: { user_id: `123`, created_at: `2025-01-01` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ]

    const fetchWrapper = (): Promise<Response> => {
      // Use resolveInMacrotask to prevent infinite microtask loops
      return resolveInMacrotask(
        new Response(JSON.stringify(mockResponseData), {
          status: 200,
          headers: {
            'content-type': `application/json`,
            'electric-handle': `test-handle`,
            'electric-offset': `0_0`,
            'electric-cursor': `1`,
            'electric-up-to-date': `true`,
            'electric-schema': JSON.stringify({
              user_id: { type: `text` },
              created_at: { type: `text` },
            }),
          },
        })
      )
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`userId`, `createdAt`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      columnMapper: snakeCamelMapper(),
    })

    const unsub = stream.subscribe((messages) => {
      receivedMessages.push(...messages)
    })

    // Wait for messages to be processed
    await new Promise((resolve) => setTimeout(resolve, 100))

    unsub()
    aborter.abort()

    // Find the change message
    const changeMessage = receivedMessages.find(isChangeMessage)
    expect(changeMessage).toBeDefined()

    // Verify column names were decoded from snake_case to camelCase
    expect(changeMessage!.value).toHaveProperty(`userId`)
    expect(changeMessage!.value).toHaveProperty(`createdAt`)
    expect((changeMessage!.value as Record<string, unknown>).userId).toBe(`123`)
    expect((changeMessage!.value as Record<string, unknown>).createdAt).toBe(
      `2025-01-01`
    )

    // Verify original db column names are not present
    expect(changeMessage!.value).not.toHaveProperty(`user_id`)
    expect(changeMessage!.value).not.toHaveProperty(`created_at`)
  })

  it(`should detect fast retry loops, clear caches, and eventually throw`, async () => {
    // Simulate a misconfigured proxy that always returns 409, causing a tight
    // retry loop that should trigger cache clearing and eventually an error.
    let requestCount = 0
    let caughtError: Error | null = null
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    const fetchMock = (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestCount++
      return Promise.resolve(
        new Response(`[]`, {
          status: 409,
          headers: {
            'content-type': `application/json`,
            'electric-handle': `handle-${requestCount}`,
          },
        })
      )
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
      onError: (error) => {
        caughtError = error
      },
    })

    stream.subscribe(() => {})

    await vi.waitFor(
      () => {
        expect(caughtError).not.toBe(null)
      },
      { timeout: 15_000 }
    )

    expect(caughtError!.message).toContain(`fast retry loop`)
    expect(caughtError!.message).toContain(`caches were cleared`)
    expect(caughtError!.message).toContain(`proxy`)
    expect(caughtError!.message).toContain(`troubleshooting`)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Clearing client-side caches`)
    )

    warnSpy.mockRestore()
  })

  it(`should reset fast-loop state when onError triggers a retry`, async () => {
    // Verifies that fast-loop detection doesn't permanently block a stream
    // after onError returns retry options. The consecutive count must reset
    // so the retried stream gets a fresh chance to sync.
    let requestCount = 0
    let errorCount = 0
    let lastError: Error | null = null
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    const fetchMock = (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestCount++

      // After the first onError retry, return a successful response
      // to prove the stream actually gets a fresh chance
      if (errorCount >= 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                key: `test-1`,
                value: { id: `1` },
                headers: {
                  operation: `insert`,
                  relation: [`public`, `test`],
                },
                offset: `0_0`,
              },
              {
                headers: { control: `up-to-date` },
                offset: `0_0`,
              },
            ]),
            {
              status: 200,
              headers: {
                'content-type': `application/json`,
                'electric-handle': `good-handle`,
                'electric-offset': `0_0`,
                'electric-schema': `{"id":{"type":"text"}}`,
              },
            }
          )
        )
      }

      // Return 409 to trigger fast-loop detection
      return Promise.resolve(
        new Response(`[]`, {
          status: 409,
          headers: {
            'content-type': `application/json`,
            'electric-handle': `handle-${requestCount}`,
          },
        })
      )
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
      onError: (error) => {
        errorCount++
        lastError = error
        // Return retry options — this should reset fast-loop state
        return { params: { table: `test` } }
      },
    })

    let gotData = false
    stream.subscribe((messages) => {
      if (messages.some((m) => `key` in m)) {
        gotData = true
      }
    })

    // The stream should: detect fast loop → throw → onError retries →
    // fast-loop state resets → successful sync with good data
    await vi.waitFor(
      () => {
        expect(gotData).toBe(true)
      },
      { timeout: 15_000 }
    )

    expect(lastError).not.toBe(null)
    expect(lastError!.message).toContain(`fast retry loop`)

    warnSpy.mockRestore()
  })

  it(`should not trigger fast-loop detection when offset advances rapidly`, async () => {
    // Normal rapid syncing with advancing offsets should never be flagged
    // as a fast loop, even if many requests happen within the detection window.
    let requestCount = 0
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    const fetchMock = (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestCount++
      const offset = `${requestCount}_0`

      // Return data pages with advancing offsets, then up-to-date
      if (requestCount <= 10) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                key: `row-${requestCount}`,
                value: { id: `${requestCount}` },
                headers: {
                  operation: `insert`,
                  relation: [`public`, `test`],
                },
                offset,
              },
            ]),
            {
              status: 200,
              headers: {
                'content-type': `application/json`,
                'electric-handle': `my-handle`,
                'electric-offset': offset,
                'electric-schema': `{"id":{"type":"text"}}`,
              },
            }
          )
        )
      }

      // After 10 pages, return up-to-date
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { headers: { control: `up-to-date` }, offset: `10_0` },
          ]),
          {
            status: 200,
            headers: {
              'content-type': `application/json`,
              'electric-handle': `my-handle`,
              'electric-offset': `10_0`,
              'electric-schema': `{"id":{"type":"text"}}`,
            },
          }
        )
      )
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    // Wait for the stream to reach up-to-date
    await vi.waitFor(
      () => {
        expect(stream.isUpToDate).toBe(true)
      },
      { timeout: 5_000 }
    )

    // Should have made many rapid requests without triggering fast-loop detection
    expect(requestCount).toBeGreaterThan(5)
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(`fast retry loop`)
    )

    warnSpy.mockRestore()
  })

  it(`should not trigger fast-loop detection during live polling`, async () => {
    // Once up-to-date, the stream enters live polling mode. Rapid live
    // requests must not be flagged as a fast loop.
    const liveAborter = new AbortController()
    let requestCount = 0
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    const fetchMock = async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestCount++

      // Stop after enough cycles to prove no fast-loop detection
      if (requestCount >= 12) {
        liveAborter.abort()
      }

      // Yield to prevent the tight loop from starving the event loop
      await new Promise((r) => setTimeout(r, 1))

      // Always return up-to-date to keep the stream in live mode.
      // Include electric-cursor for live requests.
      return new Response(
        JSON.stringify([{ headers: { control: `up-to-date` }, offset: `0_0` }]),
        {
          status: 200,
          headers: {
            'content-type': `application/json`,
            'electric-handle': `my-handle`,
            'electric-offset': `0_0`,
            'electric-schema': `{"id":{"type":"text"}}`,
            'electric-cursor': `${requestCount}`,
          },
        }
      )
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: liveAborter.signal,
      fetchClient: fetchMock,
      subscribe: true,
      onError: () => {},
    })

    stream.subscribe(() => {})

    // Wait for the stream to complete several live polling cycles then abort
    await vi.waitFor(
      () => {
        expect(requestCount).toBeGreaterThanOrEqual(10)
      },
      { timeout: 5_000 }
    )

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(`fast retry loop`)
    )

    warnSpy.mockRestore()
  })
})
