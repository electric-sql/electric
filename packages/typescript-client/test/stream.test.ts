import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ShapeStream,
  isChangeMessage,
  Message,
  Row,
  _resetHttpWarningForTesting,
} from '../src'
import { snakeCamelMapper } from '../src/column-mapper'
import { expiredShapesCache } from '../src/expired-shapes-cache'
import { upToDateTracker } from '../src/up-to-date-tracker'
import { resolveInMacrotask } from './support/test-helpers'

describe(`ShapeStream`, () => {
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController

  beforeEach(() => {
    localStorage.clear()
    expiredShapesCache.clear()
    upToDateTracker.clear()
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

  it(`should enable verbose diagnostics with localStorage electric.debug`, async () => {
    localStorage.setItem(`electric.debug`, `true`)
    const debugSpy = vi.spyOn(console, `debug`).mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, `info`).mockImplementation(() => {})

    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { headers: { control: `up-to-date` }, offset: `0_0` },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle`,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
            },
          }
        )
      )
    )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    await vi.waitFor(() => {
      expect(stream.isUpToDate).toBe(true)
    })

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(`event="diagnostics-enabled"`)
    )
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(`event="request:dispatch"`)
    )
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(`event="messages:batch"`)
    )
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(`ShapeStream diagnostics enabled`)
    )
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining(`Verbose`))

    debugSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it(`should enable verbose diagnostics with localStorage debug namespaces`, async () => {
    localStorage.setItem(`debug`, `electric*`)
    const debugSpy = vi.spyOn(console, `debug`).mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, `info`).mockImplementation(() => {})

    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { headers: { control: `up-to-date` }, offset: `0_0` },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle`,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
            },
          }
        )
      )
    )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    await vi.waitFor(() => {
      expect(stream.isUpToDate).toBe(true)
    })

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(`event="diagnostics-enabled"`)
    )
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining(`electric*`))
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(`ShapeStream diagnostics enabled`)
    )

    debugSpy.mockRestore()
    infoSpy.mockRestore()
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
      expect.stringContaining(`Clearing client-side caches`),
      expect.any(Error)
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

  it(`should ignore successful responses that arrive after a paused request was aborted`, async () => {
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    let streamRequestCount = 0
    let resolveAbortedRequest: ((response: Response) => void) | null = null
    let resolveResumedRequest: ((response: Response) => void) | null = null
    let subscriberError: Error | null = null

    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString()
      const isSnapshotRequest = url.includes(`subset__limit=`)

      if (isSnapshotRequest) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                snapshot_mark: 1,
                xmin: `0`,
                xmax: `0`,
                xip_list: [],
                database_lsn: `0`,
              },
              data: [],
            }),
            {
              status: 200,
              headers: {
                'electric-offset': `0_0`,
                'electric-handle': `snapshot-handle`,
                'electric-schema': `{}`,
              },
            }
          )
        )
      }

      streamRequestCount++

      // The first request is the one that gets aborted by the snapshot
      // pause. We deliberately ignore the abort signal and resolve later
      // to simulate a custom fetch client (or upstream wrapper) returning
      // a late success after the stream has already moved on.
      if (streamRequestCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveAbortedRequest = resolve
        })
      }

      if (streamRequestCount === 2) {
        return new Promise<Response>((resolve) => {
          resolveResumedRequest = resolve
        })
      }

      return Promise.resolve(Response.error())
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      log: `changes_only`,
      onError: () => {},
    })

    stream.subscribe(
      () => {},
      (error) => {
        subscriberError = error
      }
    )

    await vi.waitFor(() => {
      expect(streamRequestCount).toBe(1)
    })

    await stream.requestSnapshot({ limit: 1 })

    await vi.waitFor(() => {
      expect(streamRequestCount).toBe(2)
    })

    resolveResumedRequest!(
      new Response(`Bad Request`, {
        status: 400,
        statusText: `Bad Request`,
      })
    )

    await vi.waitFor(() => {
      expect(subscriberError).not.toBeNull()
    })

    resolveAbortedRequest!(
      new Response(
        JSON.stringify([{ headers: { control: `up-to-date` }, offset: `0_0` }]),
        {
          status: 200,
          headers: {
            'electric-handle': `late-handle`,
            'electric-offset': `0_0`,
            'electric-schema': `{}`,
            'electric-up-to-date': ``,
          },
        }
      )
    )

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(`Response was ignored by state "error"`),
      expect.any(Error)
    )

    warnSpy.mockRestore()
  })

  it(`onError retry loop should be bounded for persistent errors`, async () => {
    // Regression: onError always returning retry for a persistent error
    // caused an unbounded retry loop. The consecutive error retry limit
    // ensures the loop terminates.
    let requestCount = 0
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const logSpy = vi.spyOn(console, `log`).mockImplementation(() => {})

    // First request succeeds → LiveState. All subsequent → persistent 400.
    const fetchMock = vi.fn(async () => {
      requestCount++

      if (requestCount === 1) {
        return new Response(
          JSON.stringify([
            { value: { id: 1 } },
            { headers: { control: `up-to-date` } },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle`,
              'electric-offset': `0_0`,
              'electric-schema': `{"id":"int4"}`,
              'electric-up-to-date': ``,
            },
          }
        )
      }

      // 400 bypasses backoff, creating a tight retry loop
      return new Response(`Bad Request`, {
        status: 400,
        statusText: `Bad Request`,
      })
    })

    let lastError: Error | null = null
    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: true,
      onError: (error) => {
        lastError = error
        return {} // always retry — simulates TanStack DB's shouldRetryOnFailure
      },
    })

    let subscriberError: Error | null = null
    stream.subscribe(
      () => {},
      (err) => {
        subscriberError = err
      }
    )

    // The retry loop is asynchronous recursion via microtasks, so it
    // completes well within this window.
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(lastError).not.toBeNull()
    expect(subscriberError).not.toBeNull()
    // 1 initial success + 4 failing requests (limit fires at >3)
    expect(requestCount).toBeLessThan(10)
    expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(5)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`onError requested retry. Restarting stream`),
      expect.any(Error)
    )

    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  it(`onError retry counter resets after successful data`, async () => {
    // The consecutive error retry counter must reset when the stream
    // processes real data. Without the reset, intermittent error bursts
    // would accumulate across the stream's lifetime and eventually kill
    // a stream that is making progress between failures.

    let requestCount = 0
    const phase = { current: `errors1` } // errors1 → success1 → errors2 → done

    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        // Yield to the event loop to prevent OOM from deeply nested
        // recursive await this.#start() with instant mock resolution
        await new Promise((r) => setTimeout(r, 0))
        if (init?.signal?.aborted) return Response.error()

        requestCount++

        if (phase.current === `errors1` && requestCount <= 2) {
          return new Response(`Bad Request`, {
            status: 400,
            statusText: `Bad Request`,
          })
        }
        if (phase.current === `errors1`) {
          phase.current = `success1`
        }
        if (phase.current === `success1`) {
          phase.current = `errors2`
          requestCount = 0
          return new Response(
            JSON.stringify([
              { value: { id: 1 } },
              { headers: { control: `up-to-date` } },
            ]),
            {
              status: 200,
              headers: {
                'electric-handle': `test-handle`,
                'electric-offset': `0_0`,
                'electric-schema': `{"id":"int4"}`,
                'electric-cursor': `cursor-1`,
                'electric-up-to-date': ``,
              },
            }
          )
        }
        if (phase.current === `errors2` && requestCount <= 2) {
          return new Response(`Bad Request`, {
            status: 400,
            statusText: `Bad Request`,
          })
        }
        // Both bursts survived — abort
        phase.current = `done`
        aborter.abort()
        return new Response(
          JSON.stringify([
            { value: { id: 2 } },
            { headers: { control: `up-to-date` } },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle`,
              'electric-offset': `0_1`,
              'electric-schema': `{"id":"int4"}`,
              'electric-cursor': `cursor-2`,
              'electric-up-to-date': ``,
            },
          }
        )
      }
    )

    let subscriberError: Error | null = null
    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: true,
      onError: () => ({}), // always retry
    })

    stream.subscribe(
      () => {},
      (err) => {
        subscriberError = err
      }
    )

    await vi.waitFor(
      () => {
        expect(phase.current).toBe(`done`)
      },
      { timeout: 10_000 }
    )

    // Stream survived 4 total errors (2 bursts of 2) because the
    // counter reset between bursts. Without the reset, the cumulative
    // count would hit 4 and kill the stream during the second burst.
    expect(subscriberError).toBeNull()
  })

  it(`204 No Content responses reset the consecutive error retry counter`, async () => {
    // 204 is a deprecated but supported "you're caught up" response that
    // returns an empty body. The retry counter must reset on 204 success,
    // not just on non-empty message batches.
    let requestCount = 0

    // Pattern: initial 200 → LiveState, then alternating bursts of
    // 2 errors and 204 successes, repeated 4 times.
    // Total errors: 8 (exceeds the cap of 3 if the counter doesn't reset).
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 0))
      requestCount++

      // First request: initial 200 to establish shape
      if (requestCount === 1) {
        return new Response(
          JSON.stringify([
            { value: { id: 1 } },
            { headers: { control: `up-to-date` } },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `handle-204-test`,
              'electric-offset': `0_0`,
              'electric-schema': `{"id":"int4"}`,
              'electric-up-to-date': ``,
            },
          }
        )
      }

      // After initial success: cycle through 2 errors then 1 x 204, repeat
      const cyclePos = (requestCount - 2) % 3 // 0-1 = errors, 2 = 204
      if (cyclePos < 2) {
        return new Response(`Bad Request`, {
          status: 400,
          statusText: `Bad Request`,
        })
      }

      // 204 No Content — should reset counter
      return new Response(null, {
        status: 204,
        headers: {
          'electric-handle': `handle-204-test`,
          'electric-offset': `0_0`,
          'electric-schema': `{"id":"int4"}`,
          'electric-cursor': `cursor-${requestCount}`,
        },
      })
    })

    let subscriberError: Error | null = null
    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: true,
      onError: () => ({}),
    })

    stream.subscribe(
      () => {},
      (err) => {
        subscriberError = err
      }
    )

    // Wait long enough for 8+ errors across 4 cycles
    await vi.waitFor(
      () => {
        expect(requestCount).toBeGreaterThan(10)
      },
      { timeout: 10_000 }
    )

    aborter.abort()

    // If counter resets on 204, the stream survives 8+ total errors.
    // If it doesn't, the counter hits 4 and tears down the stream.
    expect(subscriberError).toBeNull()
  })

  it(`malformed 200 responses are bounded by the retry counter`, async () => {
    // A proxy/CDN returning 200 OK with invalid JSON (non-array body)
    // must still be bounded. The counter must NOT reset before the body
    // is successfully parsed, otherwise accepted headers + parse failure
    // creates an unbounded loop (counter resets to 0 every iteration).
    let requestCount = 0

    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        await new Promise((r) => setTimeout(r, 0))
        if (init?.signal?.aborted) return Response.error()
        requestCount++

        // First request: valid 200 to establish shape
        if (requestCount === 1) {
          return new Response(
            JSON.stringify([
              { value: { id: 1 } },
              { headers: { control: `up-to-date` } },
            ]),
            {
              status: 200,
              headers: {
                'electric-handle': `handle-malformed-test`,
                'electric-offset': `0_0`,
                'electric-schema': `{"id":"int4"}`,
                'electric-up-to-date': ``,
              },
            }
          )
        }

        // All subsequent: 200 OK with valid headers but non-array body
        return new Response(`{"error": "not an array"}`, {
          status: 200,
          headers: {
            'electric-handle': `handle-malformed-test`,
            'electric-offset': `0_0`,
            'electric-schema': `{"id":"int4"}`,
            'electric-cursor': `cursor-${requestCount}`,
          },
        })
      }
    )

    let subscriberError: Error | null = null
    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: true,
      onError: () => ({}),
    })

    stream.subscribe(
      () => {},
      (err) => {
        subscriberError = err
      }
    )

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // The retry counter must eventually exhaust and tear down the stream.
    // If the counter resets on accepted headers (before parse), this
    // assertion fails because the stream loops forever.
    expect(subscriberError).not.toBeNull()
    expect(requestCount).toBeLessThan(10)
  })

  describe(`HTTP URL warning`, () => {
    let windowWasPresent: boolean
    let originalWindow: typeof globalThis.window
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      // Track whether window was originally present
      windowWasPresent = `window` in globalThis
      originalWindow = globalThis.window
      // Reset the warning flag before each test
      _resetHttpWarningForTesting()
      warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    })

    afterEach(() => {
      // Clean up globals properly - delete if it wasn't present, restore if it was
      if (windowWasPresent) {
        globalThis.window = originalWindow
      } else {
        // @ts-expect-error - intentionally removing window
        delete globalThis.window
      }
      warnSpy.mockRestore()
      _resetHttpWarningForTesting()
    })

    it(`should warn when using HTTP URL in browser environment`, () => {
      // Mock browser environment with location
      globalThis.window = {
        location: { href: `http://example.com/page` },
      } as typeof globalThis.window

      const fetchWrapper = (): Promise<Response> =>
        Promise.resolve(Response.error())

      new ShapeStream({
        url: `http://example.com/v1/shape`,
        params: { table: `foo` },
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        warnOnHttp: true,
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[Electric] Using HTTP (not HTTPS)`)
      )
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`HTTP/1.1`))
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`https://electric-sql.com/r/electric-http2`)
      )
    })

    it(`should not warn when using HTTPS URL`, () => {
      // Mock browser environment
      globalThis.window = {
        location: { href: `https://example.com/page` },
      } as typeof globalThis.window

      const fetchWrapper = (): Promise<Response> =>
        Promise.resolve(Response.error())

      new ShapeStream({
        url: `https://example.com/v1/shape`,
        params: { table: `foo` },
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        warnOnHttp: true,
      })

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it(`should not warn in non-browser environment`, () => {
      // Remove window to simulate Node.js environment
      // @ts-expect-error - intentionally removing window
      delete globalThis.window

      const fetchWrapper = (): Promise<Response> =>
        Promise.resolve(Response.error())

      new ShapeStream({
        url: `http://example.com/v1/shape`,
        params: { table: `foo` },
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        warnOnHttp: true,
      })

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it(`should not warn when warnOnHttp is false`, () => {
      // Mock browser environment
      globalThis.window = {
        location: { href: `http://example.com/page` },
      } as typeof globalThis.window

      const fetchWrapper = (): Promise<Response> =>
        Promise.resolve(Response.error())

      new ShapeStream({
        url: `http://example.com/v1/shape`,
        params: { table: `foo` },
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        warnOnHttp: false,
      })

      expect(warnSpy).not.toHaveBeenCalled()
    })

    describe(`relative URL handling`, () => {
      it(`should warn when relative URL is used and window.location is http`, () => {
        // Mock browser environment with HTTP location
        globalThis.window = {
          location: { href: `http://example.com/page` },
        } as typeof globalThis.window

        const fetchWrapper = (): Promise<Response> =>
          Promise.resolve(Response.error())

        new ShapeStream({
          url: `/v1/shape`,
          params: { table: `foo` },
          signal: aborter.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })

        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`[Electric] Using HTTP (not HTTPS)`)
        )
      })

      it(`should not warn when relative URL is used and window.location is https`, () => {
        // Mock browser environment with HTTPS location
        globalThis.window = {
          location: { href: `https://example.com/page` },
        } as typeof globalThis.window

        const fetchWrapper = (): Promise<Response> =>
          Promise.resolve(Response.error())

        new ShapeStream({
          url: `/v1/shape`,
          params: { table: `foo` },
          signal: aborter.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })

        expect(warnSpy).not.toHaveBeenCalled()
      })

      it(`should resolve relative URL with query params correctly`, () => {
        // Mock browser environment with HTTP location
        globalThis.window = {
          location: { href: `http://example.com/app/` },
        } as typeof globalThis.window

        const fetchWrapper = (): Promise<Response> =>
          Promise.resolve(Response.error())

        new ShapeStream({
          url: `/v1/shape?table=foo`,
          params: { table: `foo` },
          signal: aborter.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })

        expect(warnSpy).toHaveBeenCalledTimes(1)
      })
    })

    describe(`warn-once behavior`, () => {
      it(`should only warn once even when creating multiple ShapeStreams`, () => {
        // Mock browser environment
        globalThis.window = {
          location: { href: `http://example.com/page` },
        } as typeof globalThis.window

        const fetchWrapper = (): Promise<Response> =>
          Promise.resolve(Response.error())

        // Create first stream - should warn
        new ShapeStream({
          url: `http://example.com/v1/shape`,
          params: { table: `foo` },
          signal: aborter.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })

        expect(warnSpy).toHaveBeenCalledTimes(1)

        // Create second stream with same HTTP URL - should NOT warn again
        const aborter2 = new AbortController()
        new ShapeStream({
          url: `http://example.com/v1/shape`,
          params: { table: `bar` },
          signal: aborter2.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })
        aborter2.abort()

        expect(warnSpy).toHaveBeenCalledTimes(1)

        // Create third stream with different HTTP URL - should still NOT warn
        const aborter3 = new AbortController()
        new ShapeStream({
          url: `http://other.com/v1/shape`,
          params: { table: `baz` },
          signal: aborter3.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })
        aborter3.abort()

        expect(warnSpy).toHaveBeenCalledTimes(1)
      })

      it(`should warn again after reset (for testing purposes)`, () => {
        // Mock browser environment
        globalThis.window = {
          location: { href: `http://example.com/page` },
        } as typeof globalThis.window

        const fetchWrapper = (): Promise<Response> =>
          Promise.resolve(Response.error())

        // First stream - should warn
        new ShapeStream({
          url: `http://example.com/v1/shape`,
          params: { table: `foo` },
          signal: aborter.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })

        expect(warnSpy).toHaveBeenCalledTimes(1)

        // Reset the flag
        _resetHttpWarningForTesting()

        // Second stream after reset - should warn again
        const aborter2 = new AbortController()
        new ShapeStream({
          url: `http://example.com/v1/shape`,
          params: { table: `bar` },
          signal: aborter2.signal,
          fetchClient: fetchWrapper,
          warnOnHttp: true,
        })
        aborter2.abort()

        expect(warnSpy).toHaveBeenCalledTimes(2)
      })
    })
  })
})
