import { describe, expect, inject, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import {
  ShapeStream,
  Shape,
  FetchError,
  isChangeMessage,
  isControlMessage,
} from '../src'
import { Message, Row, ChangeMessage } from '../src/types'
import { MissingHeadersError } from '../src/error'
import { resolveValue } from '../src'
import { TransformFunction } from '../src/parser'

const BASE_URL = inject(`baseUrl`)

const fetchAndSse = [{ liveSse: false }, { liveSse: true }]

/**
 * Mocks the browser's visibility API
 * and returns `pause` and `resume` functions
 * that simulate visibility changes which should trigger pausing and resuming the shape stream.
 */
function mockVisibilityApi() {
  const doc = {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }

  global.document = doc as unknown as Document

  const invokeHandlers = () => {
    const visibilityHandlers = doc.addEventListener.mock.calls.map(
      ([_, handler]) => handler
    )
    visibilityHandlers.forEach((handler) => handler())
  }

  return {
    pause: () => {
      doc.hidden = true
      invokeHandlers()
    },
    resume: () => {
      doc.hidden = false
      invokeHandlers()
    },
  }
}

describe.for(fetchAndSse)(`Shape  (liveSSE=$liveSse)`, ({ liveSse }) => {
  it(`should sync an empty shape`, async ({ issuesTableUrl, aborter }) => {
    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })
    const shape = new Shape(shapeStream)

    expect(await shape.value).toEqual(new Map())
    expect(await shape.rows).toEqual([])
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
  })

  it(`should throw on a reserved parameter`, async ({ aborter }) => {
    expect(() => {
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: `foo`,
          // @ts-expect-error should not allow reserved parameters
          live: `false`,
        },
        liveSse,
        signal: aborter.signal,
      })
      new Shape(shapeStream)
    }).toThrowErrorMatchingSnapshot()
  })

  it(`should notify with the initial value`, async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })
    const shape = new Shape(shapeStream)

    const rows = await new Promise((resolve) => {
      shape.subscribe(({ rows }) => resolve(rows))
    })

    expect(rows).toEqual([{ id: id, title: `test title`, priority: 10 }])
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
  })

  it(`should transform record with transformer function`, async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    // transformer example: uppercase keys
    const uppercaseKeys: TransformFunction = (row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k.toUpperCase(), v])
      )

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
      transformer: uppercaseKeys,
    })

    const shape = new Shape(shapeStream)

    const rows = await new Promise((resolve) => {
      shape.subscribe(({ rows }) => resolve(rows))
    })

    expect(rows).toEqual([{ ID: id, TITLE: `test title`, PRIORITY: 10 }])
  })

  it(`should continually sync a shape/table`, async ({
    issuesTableUrl,
    insertIssues,
    deleteIssue,
    updateIssue,
    waitForIssues,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const expectedValue1 = [
      {
        id: id,
        title: `test title`,
        priority: 10,
      },
    ]

    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })
    const shape = new Shape(shapeStream)
    const rows = await shape.rows

    expect(rows).toEqual(expectedValue1)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)

    await sleep(105)
    expect(shape.lastSynced()).toBeGreaterThanOrEqual(100)

    // FIXME: might get notified before all changes are submitted
    const intermediate = Date.now()
    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    const [id2] = await insertIssues({ title: `other title` })
    const [id3] = await insertIssues({ title: `other title2` })
    await deleteIssue({ id: id3, title: `other title2` })
    // Test an update too because we're sending patches that should be correctly merged in
    await updateIssue({ id: id2, title: `new title` })
    await waitForIssues({ numChangesExpected: 5 })
    await vi.waitUntil(() => hasNotified)

    const expectedValue2 = [
      ...expectedValue1,
      {
        id: id2,
        title: `new title`,
        priority: 10,
      },
    ]

    await vi.waitFor(() => expect(shape.currentRows).toEqual(expectedValue2))
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(intermediate)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - intermediate)

    shape.unsubscribeAll()
  })

  it(`should resync from scratch on a shape rotation`, async ({
    issuesTableUrl,
    insertIssues,
    deleteIssue,
    waitForIssues,
    clearIssuesShape,
    aborter,
  }) => {
    const id1 = uuidv4()
    const id2 = uuidv4()
    await insertIssues({ id: id1, title: `foo1` })

    const expectedValue1 = [
      {
        id: id1,
        title: `foo1`,
        priority: 10,
      },
    ]

    const expectedValue2 = [
      {
        id: id2,
        title: `foo2`,
        priority: 10,
      },
    ]

    const start = Date.now()
    let rotationTime: number = Infinity
    let fetchPausePromise = Promise.resolve()
    const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
      await fetchPausePromise
      return await fetch(...args)
    }

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      liveSse,
    })
    const shape = new Shape(shapeStream)
    let dataUpdateCount = 0
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(`Timed out waiting for data changes`), 1000)
      shape.subscribe(async ({ rows }) => {
        dataUpdateCount++
        if (dataUpdateCount === 1) {
          expect(rows).toEqual(expectedValue1)
          expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)

          // clear the shape and modify the data after the initial request
          fetchPausePromise = Promise.resolve().then(async () => {
            await deleteIssue({ id: id1, title: `foo1` })
            await insertIssues({ id: id2, title: `foo2` })
            await waitForIssues({ numChangesExpected: 3 })
            await clearIssuesShape(shapeStream.shapeHandle)
          })

          rotationTime = Date.now()
          return
        } else if (dataUpdateCount === 2) {
          expect(rows).toEqual(expectedValue2)
          expect(shape.lastSynced()).toBeLessThanOrEqual(
            Date.now() - rotationTime
          )
          return resolve()
        }
        throw new Error(`Received more data updates than expected`)
      })
    })
  })

  it(`should notify subscribers when the value changes`, async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })
    const shape = new Shape(shapeStream)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(({ rows }) => resolve(rows))
    })

    const [id2] = await insertIssues({ title: `other title` })

    const value = await hasNotified
    const expectedValue = [
      {
        id: id,
        title: `test title`,
        priority: 10,
      },
      {
        id: id2,
        title: `other title`,
        priority: 10,
      },
    ]
    expect(value).toEqual(expectedValue)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)

    shape.unsubscribeAll()
  })

  it(`should support unsubscribe`, async ({ issuesTableUrl, aborter }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      liveSse,
      signal: aborter.signal,
    })
    await waitForFetch(shapeStream)
    const shape = new Shape(shapeStream)

    const subFn = vi.fn((_) => void 0)

    const unsubscribeFn = shape.subscribe(subFn)
    unsubscribeFn()

    expect(shape.numSubscribers).toBe(0)
    expect(subFn).not.toHaveBeenCalled()
  })

  it(`should expose connection status`, async ({ issuesTableUrl }) => {
    const aborter = new AbortController()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })

    // give some time for the initial fetch to complete
    await waitForFetch(shapeStream)
    expect(shapeStream.isConnected()).true

    const shape = new Shape(shapeStream)
    await shape.rows

    expect(shapeStream.isConnected()).true

    // Abort the shape stream and check connectivity status
    aborter.abort()
    await vi.waitFor(() => expect(shapeStream.isConnected()).false)
  })

  it(`should set isConnected to false on fetch error and back on true when fetch succeeds again`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    let fetchShouldFail = false
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: async (_input, _init) => {
        if (fetchShouldFail)
          throw new FetchError(
            500,
            `Artifical fetch error.`,
            undefined,
            {},
            ``,
            undefined
          )
        await sleep(50)
        return new Response(
          JSON.stringify([{ headers: { control: `up-to-date` } }]),
          {
            status: 200,
            headers: new Headers({
              [`electric-offset`]: `0_0`,
              [`electric-handle`]: `foo`,
              [`electric-schema`]: ``,
              [`electric-cursor`]: `123`,
            }),
          }
        )
      },
      liveSse,
    })

    const unsubscribe = shapeStream.subscribe(() => unsubscribe())

    await vi.waitFor(() => expect(shapeStream.isConnected()).true)

    // Now make fetch fail and check the status
    fetchShouldFail = true
    await vi.waitFor(() => expect(shapeStream.isConnected()).false)

    fetchShouldFail = false
    await vi.waitFor(() => expect(shapeStream.isConnected()).true)
  })

  it(`should set isConnected to false when the stream is paused an back on true when the fetch succeeds again`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    const { pause, resume } = mockVisibilityApi()

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })

    const unsubscribe = shapeStream.subscribe(() => unsubscribe())

    await vi.waitFor(() => expect(shapeStream.isConnected()).true)

    pause()
    await vi.waitFor(() => expect(shapeStream.isConnected()).false)

    resume()
    await vi.waitFor(() => expect(shapeStream.isConnected()).true)
  })

  it(`should support pausing the stream and resuming it`, async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    const { pause, resume } = mockVisibilityApi()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      liveSse,
    })
    const shape = new Shape(shapeStream)

    function makePromise<T>() {
      let resolve: (value: T) => void = () => {}

      const promise = new Promise<T>((res) => {
        resolve = res
      })

      return {
        promise,
        resolve,
      }
    }

    const promises = [makePromise<Row[]>(), makePromise<Row[]>()]
    let i = 0

    shape.subscribe(({ rows }) => {
      const prom = promises[i]
      if (prom) {
        prom.resolve(rows)
      }
      i++
    })

    // Insert an issue
    const [id] = await insertIssues({ title: `test title` })

    const expectedValue = [
      {
        id: id,
        title: `test title`,
        priority: 10,
      },
    ]

    // Wait for the update to arrive
    const value = await promises[0].promise

    expect(value).toEqual(expectedValue)

    pause()
    await vi.waitFor(() => expect(shapeStream.isConnected()).false)

    // Now that the stream is paused, insert another issue
    const [id2] = await insertIssues({ title: `other title` })

    // The update should not arrive while paused
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve(`timeout`), 100)
    )
    await expect(Promise.race([promises[1].promise, timeout])).resolves.toBe(
      `timeout`
    )

    // Resume the stream
    resume()

    // Now the update should arrive
    const value2 = await promises[1].promise
    expect(value2).toEqual([
      ...expectedValue,
      {
        id: id2,
        title: `other title`,
        priority: 10,
      },
    ])
  })

  it(`should not throw error if an error handler is provided`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    const mockErrorHandler = vi.fn()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: async (_input, _init) => {
        return new Response(undefined, {
          status: 401,
        })
      },
      liveSse,
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
  })

  it(`should retry on error if error handler returns modified params`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    // This test creates a shapestream but provides wrong query params
    // the fetch client therefore returns a 401 status code
    // the custom error handler handles it by correcting the query param
    // after which the fetch succeeds

    const mockErrorHandler = vi.fn().mockImplementation((error) => {
      if (error instanceof FetchError && error.status === 401) {
        return {
          params: {
            todo: `pass`,
          },
        }
      }
    })

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
        todo: `fail`,
      },
      signal: aborter.signal,
      fetchClient: async (input, _init) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.searchParams.get(`todo`) === `fail`) {
          return new Response(undefined, {
            status: 401,
          })
        }

        return new Response(
          JSON.stringify([{ headers: { control: `up-to-date` } }]),
          { status: 200 }
        )
      },
      liveSse,
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
  })

  it(`should retry on error if error handler returns modified headers`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    // This test creates a shapestream but provides invalid auth credentials
    // the fetch client therefore returns a 401 status code
    // the custom error handler handles it by replacing the credentials with valid credentials
    // after which the fetch succeeds

    const mockErrorHandler = vi.fn().mockImplementation((error) => {
      if (error instanceof FetchError && error.status === 401) {
        return {
          headers: {
            Authorization: `valid credentials`,
          },
        }
      }
    })

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      headers: {
        Authorization: `invalid credentials`,
      },
      signal: aborter.signal,
      fetchClient: async (input, init) => {
        const headers = init?.headers as Record<string, string>
        if (headers && headers.Authorization === `valid credentials`) {
          return fetch(input, init)
        }

        return new Response(undefined, {
          status: 401,
        })
      },
      liveSse,
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
  })

  it(`should support async error handler`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    let authChanged: () => void
    const authChangePromise = new Promise<void>((res) => {
      authChanged = res
    })
    const mockErrorHandler = vi.fn().mockImplementation(async (error) => {
      if (error instanceof FetchError && error.status === 401) {
        authChanged()
        return {
          headers: {
            Authorization: `valid credentials`,
          },
        }
      }
    })

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      headers: {
        Authorization: `invalid credentials`,
      },
      signal: aborter.signal,
      fetchClient: async (input, init) => {
        const headers = init?.headers as Record<string, string>
        if (headers && headers.Authorization === `valid credentials`) {
          return fetch(input, init)
        }

        return new Response(undefined, {
          status: 401,
        })
      },
      liveSse,
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
    expect(shapeStream.isConnected()).toBe(false)

    await authChangePromise
    // give some time for the error handler to modify the authorization header
    await vi.waitFor(() => expect(shapeStream.isConnected()).true)
  })

  it(`should stop fetching and report an error if response is missing required headers`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    let url: string = ``
    let error1: Error, error2: Error

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: async (input, _init) => {
        url = input.toString()
        const headers = new Headers()
        headers.set(`electric-offset`, `0_0`)
        return new Response(``, { status: 200, headers })
      },
      onError: (err) => {
        error1 = err
      },
      liveSse,
    })

    const unsub = shapeStream.subscribe(() => unsub())
    expect(shapeStream.isConnected()).false

    await vi.waitFor(() => {
      const expectedErrorMessage = new MissingHeadersError(url, [
        `electric-handle`,
        `electric-schema`,
      ]).message
      expect(error1!.message).equals(expectedErrorMessage)
      expect((shapeStream.error as Error).message).equals(expectedErrorMessage)
    })

    expect(shapeStream.isConnected()).false

    // Also check that electric-cursor is a required header for responses to live queries
    const shapeStreamLive = new ShapeStream({
      url: `${BASE_URL}/v1/shape?live=true`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: async (input, _init) => {
        url = input.toString()
        const headers = new Headers()
        headers.set(`electric-offset`, `0_0`)
        return new Response(undefined, { status: 200, headers })
      },
      onError: (err) => {
        error2 = err
      },
      liveSse,
    })

    const unsubLive = shapeStreamLive.subscribe(() => unsubLive())
    expect(shapeStreamLive.isConnected()).false

    await vi.waitFor(() => {
      const expectedErrorMessageLive = new MissingHeadersError(url, [
        `electric-handle`,
        `electric-cursor`,
      ]).message
      expect(error2!.message).equals(expectedErrorMessageLive)
      expect((shapeStreamLive.error as Error).message).equals(
        expectedErrorMessageLive
      )
    })
    expect(shapeStreamLive.isConnected()).false
  })

  it(`should set isConnected to false after fetch if not subscribed`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      subscribe: false,
      liveSse,
      signal: aborter.signal,
    })

    await waitForFetch(shapeStream)

    // We should no longer be connected because
    // the initial fetch finished and we've not subscribed to changes
    await vi.waitFor(() => expect(shapeStream.isConnected()).false)
  })

  it(`should expose isLoading status`, async ({ issuesTableUrl, aborter }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: async (input, init) => {
        await sleep(20)
        return fetch(input, init)
      },
      liveSse,
    })

    expect(shapeStream.isLoading()).true

    await waitForFetch(shapeStream) // Snapshot end marker
    await waitForFetch(shapeStream) // up-to-date marker
    expect(shapeStream.isLoading()).false
  })

  it(`should expose lastOffset`, async ({ issuesTableUrl, aborter }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: async (input, init) => {
        await sleep(20)
        return fetch(input, init)
      },
      liveSse,
    })
    const shape = new Shape(shapeStream)

    expect(shapeStream.lastOffset).toBe(`-1`)
    expect(shape.lastOffset).toBe(shapeStream.lastOffset)
    await waitForFetch(shapeStream)

    shape.unsubscribeAll()
  })

  it(`should honour replica: full`, async ({
    issuesTableUrl,
    insertIssues,
    updateIssue,
    clearIssuesShape,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `first title` })

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
        replica: `full`,
      },
      liveSse,
      signal: aborter.signal,
    })

    let unsub: () => void = () => {}
    try {
      const lastMsgs: Message<Row>[] = []
      unsub = shapeStream.subscribe((msgs) => {
        lastMsgs.push(...msgs)
      })

      await vi.waitFor(() => {
        const msg = lastMsgs.shift()
        expect(msg?.headers.control).toEqual(`up-to-date`)
      })

      const expectedValue = {
        id: id,
        title: `updated title`,
        // because we're sending the full row, the update will include the
        // unchanged `priority` column
        priority: 10,
      }
      await updateIssue({ id: id, title: `updated title` })

      await vi.waitFor(
        () => {
          const msg = lastMsgs.shift()
          if (!msg) throw new Error(`Update message not yet received`)
          const changeMsg: ChangeMessage<Row> = msg as ChangeMessage<Row>
          expect(changeMsg.headers.operation).toEqual(`update`)
          expect(changeMsg.value).toEqual(expectedValue)
        },
        { timeout: 2000 }
      )
    } finally {
      unsub()
      // the normal cleanup doesn't work because our shape definition is
      // changed by the updates: 'full' param
      await clearIssuesShape(shapeStream.shapeHandle)
    }
  })

  it(`should support function-based params and headers`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    const mockParamFn = vi.fn().mockReturnValue(`test-value`)
    const mockAsyncParamFn = vi.fn().mockResolvedValue(`test-value`)
    const mockHeaderFn = vi.fn().mockReturnValue(`test-value`)
    const mockAsyncHeaderFn = vi.fn().mockResolvedValue(`test-value`)

    // Test with synchronous functions
    const shapeStream1 = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
        customParam: mockParamFn,
      },
      headers: {
        'X-Custom-Header': mockHeaderFn,
      },
      liveSse,
      signal: aborter.signal,
    })
    const shape1 = new Shape(shapeStream1)
    await shape1.value

    expect(mockParamFn).toHaveBeenCalled()
    expect(mockHeaderFn).toHaveBeenCalled()

    // Test with async functions
    const shapeStream2 = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
        customParam: mockAsyncParamFn,
      },
      headers: {
        'X-Custom-Header': mockAsyncHeaderFn,
      },
      liveSse,
      signal: aborter.signal,
    })
    const shape2 = new Shape(shapeStream2)
    await shape2.value

    expect(mockAsyncParamFn).toHaveBeenCalled()
    expect(mockAsyncHeaderFn).toHaveBeenCalled()

    // Verify the resolved values
    expect(await resolveValue(mockParamFn())).toBe(`test-value`)
    expect(await resolveValue(mockAsyncParamFn())).toBe(`test-value`)
  })

  it(`should support offset=now to skip historical data`, async ({
    issuesTableUrl,
    insertIssues,
    waitForIssues,
    aborter,
  }) => {
    // Create initial data
    const [id1] = await insertIssues({ title: `historical data` })
    await waitForIssues({ numChangesExpected: 1 })

    // Create a shape with offset=now
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      offset: `now`,
      signal: aborter.signal,
      liveSse,
    })
    const shape = new Shape(shapeStream)

    // Wait for initial sync to complete
    await shape.rows

    // Verify initial state is empty despite existing data
    expect(shape.currentRows).toEqual([])

    // Now insert new data after the stream has started
    const [id2] = await insertIssues({ title: `new data` })

    // Wait for the new data to arrive
    await vi.waitFor(
      () => {
        expect(shape.currentRows).toEqual([
          {
            id: id2,
            title: `new data`,
            priority: 10,
          },
        ])
      },
      { timeout: 3000 }
    )

    // Verify historical data was not included
    expect(shape.currentRows.find((row) => row.id === id1)).toBeUndefined()
  })

  it(`should support forceDisconnectAndRefresh() to force a sync`, async ({
    issuesTableUrl,
    insertIssues,
    updateIssue,
    waitForIssues,
    aborter,
  }) => {
    // Create initial data
    const [id] = await insertIssues({ title: `initial title` })
    await waitForIssues({ numChangesExpected: 1 })

    // Track fetch requests
    let pendingRequests: Array<[string | URL | Request, () => Promise<void>]> =
      []

    const resolveRequests = async () => {
      for (const [_, doFetch] of pendingRequests) {
        await doFetch()
      }
      pendingRequests = [] // clear the array
    }

    const fetchClient = async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const signal = init?.signal
      return new Promise<Response>((resolve, reject) => {
        signal?.addEventListener(
          `abort`,
          () => {
            reject(new Error(`AbortError`))
          },
          { once: true }
        )
        pendingRequests.push([
          input,
          async () => {
            try {
              const response = await fetch(input, init)
              resolve(response)
            } catch (e) {
              reject(e)
            }
          },
        ])
      })
    }

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient,
      liveSse,
    })

    // Subscribe to start the stream
    const shape = new Shape(shapeStream)

    // Wait for initial fetch to start: offset: -1
    await vi.waitFor(() => expect(pendingRequests.length).toBe(1))
    expect(pendingRequests[0][0].toString()).toContain(`offset=-1`)

    // Complete initial fetch
    await resolveRequests()

    // Wait for second fetch to start: offset: 0_0
    await vi.waitFor(() => expect(pendingRequests.length).toBe(1))
    expect(pendingRequests[0][0].toString()).toContain(`offset=0_0`)

    // Complete second fetch
    await resolveRequests()

    // We should be in live mode
    await vi.waitFor(() => expect(pendingRequests.length).toBe(1))
    expect(pendingRequests[0][0].toString()).toContain(`live=true`)

    // Update data while stream is long polling and ensure it has been processed
    await updateIssue({ id, title: `updated title` })
    await waitForIssues({
      numChangesExpected: 1,
      shapeStreamOptions: {
        offset: shapeStream.lastOffset,
        handle: shapeStream.shapeHandle,
      },
    })

    // Start refresh
    const refreshPromise = shapeStream.forceDisconnectAndRefresh()

    // Verify the long polling request was aborted and a new request started
    await vi.waitFor(() => expect(pendingRequests.length).toBe(2))
    expect(pendingRequests.length).toBe(2) // Aborted long poll + refresh request
    expect(pendingRequests[0][0].toString()).toContain(`live=true`) // The aborted long poll
    expect(pendingRequests[1][0].toString()).not.toContain(`live=true`) // The refresh request

    // Complete refresh request
    // This will abort the long poll and start a new one
    await resolveRequests()

    // Wait for the refresh to complete, this resolves once the next request
    // after calling forceDisconnectAndRefresh() has completed
    await refreshPromise

    // Verify we got the updated data
    expect(shape.currentRows).toEqual([
      {
        id,
        title: `updated title`,
        priority: 10,
      },
    ])

    // Verify we return to normal processing (long polling)
    await vi.waitFor(() => expect(pendingRequests.length).toBe(1)) // New long poll
    expect(pendingRequests[0][0].toString()).toContain(`live=true`)
  })
})

describe.for(fetchAndSse)(
  `Shape - backwards compatible (liveSSE=$liveSse)`,
  ({ liveSse }) => {
    it(`should set isConnected to false on fetch error and back on true when fetch succeeds again`, async ({
      issuesTableUrl,
      aborter,
    }) => {
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        fetchClient: async (_input, _init) => {
          await sleep(20)
          return new Response(null, {
            status: 204,
            headers: new Headers({
              [`electric-offset`]: `0_0`,
              [`electric-handle`]: `foo`,
              [`electric-schema`]: ``,
              [`electric-cursor`]: `123`,
            }),
          })
        },
        liveSse,
      })

      const unsubscribe = shapeStream.subscribe(() => unsubscribe())

      await vi.waitFor(() => expect(shapeStream.isConnected()).true)
      expect(shapeStream.lastSyncedAt()).closeTo(Date.now(), 200)

      await sleep(400)

      expect(shapeStream.lastSyncedAt()).closeTo(Date.now(), 200)
    })
  }
)

describe(`Shape - SSE`, () => {
  it(`should handle SSE messages in batches`, async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    // Create some initial data
    const [id1] = await insertIssues({ title: `initial title` })

    // Track if we've already thrown an error to ensure we only throw once
    let hasThrownError = false

    let resolveRefresh: () => void = () => {}
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })

    // Custom fetch client that intercepts SSE messages
    const customFetchClient = async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = input.toString()

      // Only intercept SSE requests (those with live_sse=true)
      if (url.includes(`live_sse=true`)) {
        // Create a custom response that intercepts the SSE stream
        const response = await fetch(input, init)

        // Create a custom readable stream that intercepts messages
        const originalBody = response.body
        if (!originalBody) {
          throw new Error(`No response body`)
        }

        const filteredStream = response.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(
            createSSEFilterStream((event) => {
              const data = event.slice(6) // remove 'data: ' prefix

              let message
              try {
                message = JSON.parse(data)
              } catch (_parseError) {
                // Ignore JSON parse errors for non-JSON lines
              }

              // Check if this is the first up-to-date message
              if (
                message.headers?.control === `up-to-date` &&
                !hasThrownError
              ) {
                hasThrownError = true

                // Force a refresh to interrupt the stream
                shapeStream.forceDisconnectAndRefresh().then(resolveRefresh)

                // Filter it out
                return false
              }

              return true
            })
          )
          .pipeThrough(new TextEncoderStream())

        // Return a new response with our custom stream
        return new Response(filteredStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }

      // For non-SSE requests, just forward to the real fetch
      return fetch(input, init)
    }

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: { table: issuesTableUrl },
      signal: aborter.signal,
      liveSse: true,
      fetchClient: customFetchClient,
    })

    // Track received messages to ensure no duplicates
    const receivedRows: Array<Row> = []
    const messageIds = new Set<string>()

    let resolveInitialSync: () => void = () => {}
    const initialSyncComplete = new Promise<void>((resolve) => {
      resolveInitialSync = resolve
    })

    // Subscribe to the shape stream
    const unsubscribe = shapeStream.subscribe((messages) => {
      for (const message of messages) {
        if (isChangeMessage(message)) {
          // Check for duplicates
          const rowId = message.key
          if (messageIds.has(rowId)) {
            throw new Error(`Duplicate message received for id: ${rowId}`)
          }
          messageIds.add(rowId)
          receivedRows.push(message.value)
        }

        if (
          isControlMessage(message) &&
          message.headers.control === `up-to-date`
        ) {
          resolveInitialSync()
        }
      }
    })

    // Wait for initial sync
    await initialSyncComplete

    // Insert another issue to trigger an update
    const [id2] = await insertIssues({ title: `second title` })

    // Wait for the update to be processed
    await vi.waitFor(
      () => {
        expect(receivedRows.length).toBe(2)
      },
      { timeout: 5000 }
    )

    // Verify we received both messages without duplicates
    expect(receivedRows).toEqual([
      {
        id: id1,
        title: `initial title`,
        priority: 10,
      },
      {
        id: id2,
        title: `second title`,
        priority: 10,
      },
    ])

    // Check that we interrupted the stream
    expect(hasThrownError).toBe(true)

    // Await the refresh to complete
    await refreshPromise

    // Verify that there are no duplicates after the refresh
    expect(receivedRows.length).toBe(2)
    expect(messageIds.size).toBe(2)

    // Verify the stream is connected and up to date
    expect(shapeStream.isConnected()).toBe(true)
    expect(shapeStream.isUpToDate).toBe(true)

    unsubscribe()
  })
})

function waitForFetch(stream: ShapeStream): Promise<void> {
  let unsub = () => {}
  return new Promise<void>((resolve) => {
    unsub = stream.subscribe(
      () => resolve(),
      () => resolve()
    )
  }).finally(() => unsub())
}

// Simple SSE parser that buffers lines until an event is complete
// And filters out events that don't pass the filter function
function createSSEFilterStream(filterFn: (event: string) => boolean) {
  let buffer = ``
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk
      const lines = buffer.split(`\n`)
      buffer = lines.pop() || `` // Keep the last incomplete line
      let currentEvent = ``
      for (const line of lines) {
        currentEvent += line + `\n`
        if (line.trim() === ``) {
          // End of event
          if (filterFn(currentEvent)) {
            controller.enqueue(currentEvent)
          }
          currentEvent = ``
        }
      }
    },
    flush(controller) {
      // Emit any remaining buffered event
      if (buffer && filterFn(buffer)) {
        controller.enqueue(buffer)
      }
    },
  })
}

describe.for(fetchAndSse)(
  `Shape - changes_only mode (liveSSE=$liveSse)`,
  ({ liveSse }) => {
    it(`should expose mode on Shape`, async ({ issuesTableUrl, aborter }) => {
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)
      expect(shape.mode).toBe(`changes_only`)
    })

    it(`should start empty even when data exists`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `pre-existing` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })

      const shape = new Shape(shapeStream)

      expect(await shape.rows).toEqual([])
    })

    it(`should propagate updates immediately as update messages`, async ({
      issuesTableUrl,
      insertIssues,
      updateIssue,
      aborter,
    }) => {
      const [id] = await insertIssues({ title: `before` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })

      const messages: Message<Row>[] = []
      const unsubscribe = shapeStream.subscribe((msgs) => {
        messages.push(...msgs)
      })

      await waitForFetch(shapeStream)

      await updateIssue({ id, title: `after` })

      await vi.waitFor(() => {
        const updateMsg = messages.find(
          (m) => isChangeMessage(m) && m.headers.operation === `update`
        ) as ChangeMessage<Row> | undefined
        expect(updateMsg?.value?.title).toBe(`after`)
      })

      unsubscribe()
    })

    it(`requestSnapshot should populate stream and match returned data`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `A` }, { title: `B` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })

      const shape = new Shape(shapeStream)

      // Initial state should be empty
      expect(await shape.rows).toEqual([])

      // Capture messages published to the stream during snapshot
      const seenKeys = new Set<string>()
      const unsub = shapeStream.subscribe((msgs) => {
        for (const m of msgs) {
          if (isChangeMessage(m)) seenKeys.add(m.key)
        }
      })

      const { data } = await shapeStream.requestSnapshot({
        orderBy: `title ASC`,
        limit: 100,
      })

      // Wait until shape reflects the snapshot
      await vi.waitFor(() => {
        expect(shape.currentRows.length).toBe(data.length)
      })

      // Compare keys in stream vs returned snapshot data
      const returnedKeys = new Set(data.map((m) => m.key))
      expect(seenKeys).toEqual(returnedKeys)

      // Compare values (ignoring order)
      const rowsById = new Map(shape.currentRows.map((r) => [r.id, r]))
      for (const msg of data) {
        const row = rowsById.get(msg.value.id)
        expect(row).toBeTruthy()
        Object.entries(msg.value).forEach(([k, v]) => {
          expect(row![k]).toEqual(v)
        })
      }

      unsub()
    })

    it(`requestSnapshot supports orderBy`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `B` }, { title: `C` }, { title: `A` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const _shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)

      const { data } = await shapeStream.requestSnapshot({
        orderBy: `title ASC`,
        limit: 100,
      })
      const titles = data.map((m) => m.value.title)
      expect(titles).toEqual([`A`, `B`, `C`])
    })

    it(`requestSnapshot supports where clause`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `foo` }, { title: `bar` }, { title: `baz` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const _shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)

      const { data } = await shapeStream.requestSnapshot({
        where: `title = 'bar'`,
        orderBy: `title ASC`,
        limit: 100,
      })
      const titles = data.map((m) => m.value.title)
      expect(titles).toEqual([`bar`])
    })

    it(`requestSnapshot supports parametrised where clause`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `one` }, { title: `two` }, { title: `three` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const _shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)

      const { data } = await shapeStream.requestSnapshot({
        where: `title = $1 OR title = $2`,
        params: { '1': `two`, '2': `three` },
        orderBy: `title ASC`,
        limit: 100,
      })
      const titles = data.map((m) => m.value.title).sort()
      expect(titles).toEqual([`three`, `two`])
    })

    it(`requestSnapshot supports orderBy + limit`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `a` }, { title: `b` }, { title: `c` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const _shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)

      const { data } = await shapeStream.requestSnapshot({
        orderBy: `title DESC`,
        limit: 2,
      })
      const titles = data.map((m) => m.value.title)
      expect(titles).toEqual([`c`, `b`])
    })

    it(`should stream updates after snapshot completes`, async ({
      issuesTableUrl,
      insertIssues,
      updateIssue,
      aborter,
    }) => {
      const [id] = await insertIssues({ title: `before` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const _shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)

      // Perform a snapshot to populate data and ensure pause/resume flow
      await shapeStream.requestSnapshot({ orderBy: `title ASC`, limit: 100 })

      // Now perform an update and ensure it is streamed after snapshot finishes
      const messages: Message<Row>[] = []
      const unsub = shapeStream.subscribe((msgs) => {
        messages.push(...msgs)
      })
      await updateIssue({ id, title: `after` })

      await vi.waitFor(() => {
        const updateMsg = messages.find(
          (m) => isChangeMessage(m) && m.headers.operation === `update`
        ) as ChangeMessage<Row> | undefined
        expect(updateMsg?.value?.title).toBe(`after`)
      })
      unsub()
    })

    it(`should wait for up-to-date message before pausing for snapshot`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `A` }, { title: `B` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })

      const allMessages: Array<Message<Row>> = []
      const unsub = shapeStream.subscribe((msgs) => {
        allMessages.push(...msgs)
      })

      await vi.waitFor(() => {
        expect(
          allMessages.some(
            (m) => isControlMessage(m) && m.headers.control === `up-to-date`
          )
        ).toBe(true)
      })

      await shapeStream.requestSnapshot({
        orderBy: `title ASC`,
        limit: 100,
      })

      // Find all snapshot-end messages - there should be at least 2:
      // one from the initial sync and one from the snapshot request
      const snapshotEndIndices = allMessages
        .map((m, i) => ({ m, i }))
        .filter(
          ({ m }) => isControlMessage(m) && m.headers.control === `snapshot-end`
        )
        .map(({ i }) => i)

      expect(snapshotEndIndices.length).toBe(2)

      // The snapshot-end from the snapshot request should have a snapshot_mark
      const snapshotRequestEndIndex = allMessages.findIndex(
        (m) =>
          isControlMessage(m) &&
          m.headers.control === `snapshot-end` &&
          `snapshot_mark` in m.headers
      )

      // Find the up-to-date message from the initial sync
      const upToDateIndex = allMessages.findIndex(
        (m) => isControlMessage(m) && m.headers.control === `up-to-date`
      )

      // Find the first insert from the snapshot (has snapshot_mark)
      const firstSnapshotInsertIndex = allMessages.findIndex(
        (m) => isChangeMessage(m) && `snapshot_mark` in m.headers
      )

      // Verify that:
      // 1. We have an up-to-date message before the snapshot data
      // 2. The snapshot inserts come after the up-to-date
      // 3. The snapshot-end marker comes after the snapshot inserts
      expect(upToDateIndex).toBeGreaterThan(-1)
      expect(firstSnapshotInsertIndex).toBeGreaterThan(-1)
      expect(snapshotRequestEndIndex).toBeGreaterThan(-1)

      // The up-to-date should come before the snapshot data
      expect(upToDateIndex).toBeLessThan(firstSnapshotInsertIndex)

      // The snapshot-end should come after the snapshot data
      expect(snapshotRequestEndIndex).toBeGreaterThan(firstSnapshotInsertIndex)

      unsub()
    })

    it(`should observe update committed after snapshot taken in parallel transaction`, async ({
      issuesTableUrl,
      issuesTableSql,
      insertIssues,
      dbClient,
      aborter,
    }) => {
      const [id] = await insertIssues({ title: `base` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const _shape = new Shape(shapeStream)
      await waitForFetch(shapeStream)

      // Begin a transaction and update the row, but do not commit yet
      await dbClient.query(`BEGIN`)
      await dbClient.query(
        `UPDATE ${issuesTableSql} SET title = $2 WHERE id = $1`,
        [id, `updated-in-tx`]
      )

      // Take a snapshot that includes this row by id
      await shapeStream.requestSnapshot({
        where: `id = $1`,
        params: { '1': id },
        orderBy: `id ASC`,
        limit: 100,
      })

      // Now commit the transaction so the update becomes visible and is replicated
      await dbClient.query(`COMMIT`)

      // Expect to observe the update via the replication stream
      const seen: Array<ChangeMessage<Row>> = []
      const unsub = shapeStream.subscribe((msgs) => {
        for (const m of msgs)
          if (isChangeMessage(m)) seen.push(m as ChangeMessage<Row>)
      })

      await vi.waitFor(() => {
        const upd = seen.find(
          (m) => m.key && m.value.id === id && m.headers.operation === `update`
        )
        expect(upd?.value?.title).toBe(`updated-in-tx`)
      })
      unsub()
    })

    it(`should ignore updates/deletes for unseen keys until insert observed`, async ({
      issuesTableUrl,
      insertIssues,
      updateIssue,
      deleteIssue,
      waitForIssues,
      aborter,
    }) => {
      // Create a row before starting the stream
      const [preId] = await insertIssues({ title: `pre` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const shape = new Shape(shapeStream)

      // Subscribe to capture raw messages to know when updates arrive
      const seen: Message<Row>[] = []
      const unsub = shape.stream.subscribe((msgs) => {
        seen.push(...msgs)
      })

      // Initial state should be empty
      expect(await shape.rows).toEqual([])

      // Update pre-existing row; Shape should ignore
      await updateIssue({ id: preId, title: `pre-updated` })
      await waitForIssues({ numChangesExpected: 1 })
      await vi.waitFor(() => {
        expect(
          seen.some(
            (m) =>
              isChangeMessage(m) &&
              m.headers.operation === `update` &&
              (m as ChangeMessage<Row>).value.id === preId
          )
        ).toBe(true)
      })
      expect(shape.currentRows).toEqual([])

      // Delete pre-existing row; still ignored
      await deleteIssue({ id: preId, title: `pre-updated` })
      await waitForIssues({ numChangesExpected: 1 })
      await vi.waitFor(() => {
        expect(
          seen.some(
            (m) => isChangeMessage(m) && m.headers.operation === `delete`
          )
        ).toBe(true)
      })
      expect(shape.currentRows).toEqual([])

      // Insert a new row after the stream starts; Shape should include it
      const [id2] = await insertIssues({ title: `live` })
      await vi.waitFor(() => {
        const rows = shape.currentRows
        expect(rows.length).toBe(1)
        expect(rows[0].id).toBe(id2)
        expect(rows[0].title).toBe(`live`)
      })

      // Update the inserted row; Shape should apply update
      await updateIssue({ id: id2, title: `live-updated` })
      await waitForIssues({ numChangesExpected: 1 })
      await vi.waitFor(() => {
        const rows = shape.currentRows
        expect(rows.length).toBe(1)
        expect(rows[0].title).toBe(`live-updated`)
      })

      // Delete the inserted row; Shape should remove it
      await deleteIssue({ id: id2, title: `live-updated` })
      await waitForIssues({ numChangesExpected: 1 })
      await vi.waitFor(() => {
        expect(shape.currentRows).toEqual([])
      })

      unsub()
    })

    it(`Shape.requestSnapshot should populate data and return void`, async ({
      issuesTableUrl,
      insertIssues,
      aborter,
    }) => {
      await insertIssues({ title: `A` }, { title: `B` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
      })
      const shape = new Shape(shapeStream)

      // Initially empty
      expect(await shape.rows).toEqual([])

      const result = await shape.requestSnapshot({
        orderBy: `title ASC`,
        limit: 100,
      })
      expect(result).toBeUndefined()

      await vi.waitFor(() => {
        expect(shape.currentRows.length).toBe(2)
      })
      const titles = shape.currentRows.map((r) => r.title).sort()
      expect(titles).toEqual([`A`, `B`])
    })

    it(`should re-execute requested sub-snapshots on must-refetch`, async ({
      issuesTableUrl,
      insertIssues,
      deleteIssue,
      waitForIssues,
      clearIssuesShape,
      aborter,
    }) => {
      const [_, id2] = await insertIssues(
        { title: `snap1` },
        { title: `snap2` }
      )

      let fetchPausePromise: Promise<void> = Promise.resolve()
      const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
        await fetchPausePromise
        return await fetch(...args)
      }

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: { table: issuesTableUrl },
        log: `changes_only`,
        liveSse,
        signal: aborter.signal,
        fetchClient: fetchWrapper,
      })
      const shape = new Shape(shapeStream)

      // Request a snapshot to populate data (and to be re-executed later)
      await shape.requestSnapshot({ orderBy: `title ASC`, limit: 100 })
      await vi.waitFor(() => {
        expect(shape.currentRows.length).toBe(2)
      })

      // Prepare rotation: before next fetch, delete id2 and insert a new row, then clear shape
      fetchPausePromise = Promise.resolve().then(async () => {
        await deleteIssue({ id: id2, title: `snap2` })
        await insertIssues({ title: `snap3` })
        await waitForIssues({ numChangesExpected: 2 })
        await clearIssuesShape(shapeStream.shapeHandle)
      })

      // Wait until shape reflects re-executed snapshot on the new shape
      await vi.waitFor(
        () => {
          const titles = shape.currentRows.map((r) => r.title).sort()
          expect(titles).toEqual([`snap1`, `snap3`])
        },
        { timeout: 4000 }
      )
    })
  }
)
