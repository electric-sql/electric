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
})

describe(`Wake detection`, () => {
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController
  let savedDocument: typeof globalThis.document | undefined

  beforeEach(() => {
    aborter = new AbortController()
    // Save and remove document to simulate non-browser (Bun/Node.js) environment
    savedDocument = globalThis.document
    delete (globalThis as Record<string, unknown>).document
  })

  afterEach(() => {
    aborter.abort()
    // Restore document
    if (savedDocument !== undefined) {
      globalThis.document = savedDocument
    }
    vi.restoreAllMocks()
  })

  it(`should set up wake detection timer in non-browser environments`, async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, `clearInterval`)

    const fetchWrapper = (): Promise<Response> => {
      return resolveInMacrotask(Response.error())
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    // unsubscribeAll should clear the wake detection timer
    stream.unsubscribeAll()
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(1)

    unsub()
  })

  it(`should NOT set up wake detection timer in browser environments`, async () => {
    // Restore document to simulate browser environment
    ;(globalThis as Record<string, unknown>).document = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    const clearIntervalSpy = vi.spyOn(globalThis, `clearInterval`)

    const fetchWrapper = (): Promise<Response> => {
      return resolveInMacrotask(Response.error())
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    // In browser env, unsubscribeAll should NOT have a wake detection timer to clear
    // (only visibility change handler)
    stream.unsubscribeAll()
    // clearInterval might be called 0 times (no wake timer was set up)
    // We verify by checking that no interval was created for wake detection
    // The visibility handler uses addEventListener, not setInterval
    expect(clearIntervalSpy.mock.calls.length).toBe(0)

    unsub()
  })

  it(`should detect time gap and abort stale fetch after system wake`, async () => {
    vi.useFakeTimers()

    const fetchSignals: AbortSignal[] = []
    const fetchEvents = new EventTarget()
    let fetchCallCount = 0

    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const signal = args[1]?.signal
      if (signal) fetchSignals.push(signal)
      fetchCallCount++
      fetchEvents.dispatchEvent(new Event(`fetch`))
      // Simulate a hanging long-poll that rejects on abort
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(`abort`, () => reject(new Error(`aborted`)), {
          once: true,
        })
      })
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    // Wait for first fetch
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCallCount).toBeGreaterThanOrEqual(1)
    const initialFetchCount = fetchCallCount

    // Advance one normal interval (10s) — should NOT trigger wake detection
    await vi.advanceTimersByTimeAsync(10_001)
    expect(fetchSignals[fetchSignals.length - 1]?.aborted).toBe(false)

    // Simulate system sleep: jump Date.now() forward by 30s
    // then advance timer to fire the next interval callback
    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 30_000) // Date.now() jumps 30s

    // Advance just enough to trigger the next interval tick
    await vi.advanceTimersByTimeAsync(10_001)

    // The wake detection should have aborted the stale fetch
    // and the fetch loop should have restarted with a new fetch
    // Give the async restart a moment to trigger
    await vi.advanceTimersByTimeAsync(100)

    // Verify the first signal was aborted
    expect(fetchSignals[0]?.aborted).toBe(true)

    // Verify new fetches were made (fetch loop restarted)
    expect(fetchCallCount).toBeGreaterThan(initialFetchCount)

    unsub()
    aborter.abort()
    vi.useRealTimers()
  })
})
