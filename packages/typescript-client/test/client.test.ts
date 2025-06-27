import { describe, expect, inject, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { ShapeStream, Shape, FetchError } from '../src'
import { Message, Row, ChangeMessage } from '../src/types'
import { MissingHeadersError } from '../src/error'
import { resolveValue } from '../src'

const BASE_URL = inject(`baseUrl`)

const fetchAndSse = [
  { experimentalLiveSse: false },
  { experimentalLiveSse: true },
]

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

describe(`Shape`, () => {
  it.for(fetchAndSse)(
    `should sync an empty shape (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
      const start = Date.now()
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        experimentalLiveSse,
      })
      const shape = new Shape(shapeStream)

      expect(await shape.value).toEqual(new Map())
      expect(await shape.rows).toEqual([])
      expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
      expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
      expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
    }
  )

  it.for(fetchAndSse)(
    `should throw on a reserved parameter (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { aborter }) => {
      expect(() => {
        const shapeStream = new ShapeStream({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: `foo`,
            // @ts-expect-error should not allow reserved parameters
            live: `false`,
          },
          experimentalLiveSse,
          signal: aborter.signal,
        })
        new Shape(shapeStream)
      }).toThrowErrorMatchingSnapshot()
    }
  )

  it.for(fetchAndSse)(
    `should notify with the initial value (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      { issuesTableUrl, insertIssues, aborter }
    ) => {
      const [id] = await insertIssues({ title: `test title` })

      const start = Date.now()
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        experimentalLiveSse,
      })
      const shape = new Shape(shapeStream)

      const rows = await new Promise((resolve) => {
        shape.subscribe(({ rows }) => resolve(rows))
      })

      expect(rows).toEqual([{ id: id, title: `test title`, priority: 10 }])
      expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
      expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
      expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
    }
  )

  it.for(fetchAndSse)(
    `should continually sync a shape/table (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      {
        issuesTableUrl,
        insertIssues,
        deleteIssue,
        updateIssue,
        waitForIssues,
        aborter,
      }
    ) => {
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
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should resync from scratch on a shape rotation (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      {
        issuesTableUrl,
        insertIssues,
        deleteIssue,
        waitForIssues,
        clearIssuesShape,
        aborter,
      }
    ) => {
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
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should notify subscribers when the value changes (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      { issuesTableUrl, insertIssues, aborter }
    ) => {
      const [id] = await insertIssues({ title: `test title` })

      const start = Date.now()
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should support unsubscribe (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        experimentalLiveSse,
        signal: aborter.signal,
      })
      await waitForFetch(shapeStream)
      const shape = new Shape(shapeStream)

      const subFn = vi.fn((_) => void 0)

      const unsubscribeFn = shape.subscribe(subFn)
      unsubscribeFn()

      expect(shape.numSubscribers).toBe(0)
      expect(subFn).not.toHaveBeenCalled()
    }
  )

  it.for(fetchAndSse)(
    `should expose connection status (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl }) => {
      const aborter = new AbortController()
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should set isConnected to false on fetch error and back on true when fetch succeeds again (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
      })

      const unsubscribe = shapeStream.subscribe(() => unsubscribe())

      await vi.waitFor(() => expect(shapeStream.isConnected()).true)

      // Now make fetch fail and check the status
      fetchShouldFail = true
      await vi.waitFor(() => expect(shapeStream.isConnected()).false)

      fetchShouldFail = false
      await vi.waitFor(() => expect(shapeStream.isConnected()).true)
    }
  )

  it.for(fetchAndSse)(
    `should set isConnected to false when the stream is paused an back on true when the fetch succeeds again (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
      const { pause, resume } = mockVisibilityApi()

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        experimentalLiveSse,
      })

      const unsubscribe = shapeStream.subscribe(() => unsubscribe())

      await vi.waitFor(() => expect(shapeStream.isConnected()).true)

      pause()
      await vi.waitFor(() => expect(shapeStream.isConnected()).false)

      resume()
      await vi.waitFor(() => expect(shapeStream.isConnected()).true)
    }
  )

  it.for(fetchAndSse)(
    `should support pausing the stream and resuming it (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      { issuesTableUrl, insertIssues, aborter }
    ) => {
      const { pause, resume } = mockVisibilityApi()
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should not throw error if an error handler is provided (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
        onError: mockErrorHandler,
      })

      await waitForFetch(shapeStream)
      expect(mockErrorHandler.mock.calls.length).toBe(1)
      expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
    }
  )

  it.for(fetchAndSse)(
    `should retry on error if error handler returns modified params (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
        onError: mockErrorHandler,
      })

      await waitForFetch(shapeStream)
      expect(mockErrorHandler.mock.calls.length).toBe(1)
      expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
    }
  )

  it.for(fetchAndSse)(
    `should retry on error if error handler returns modified headers (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
        onError: mockErrorHandler,
      })

      await waitForFetch(shapeStream)
      expect(mockErrorHandler.mock.calls.length).toBe(1)
      expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
    }
  )

  it.for(fetchAndSse)(
    `should support async error handler (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
        onError: mockErrorHandler,
      })

      await waitForFetch(shapeStream)
      expect(mockErrorHandler.mock.calls.length).toBe(1)
      expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
      expect(shapeStream.isConnected()).toBe(false)

      await authChangePromise
      // give some time for the error handler to modify the authorization header
      await vi.waitFor(() => expect(shapeStream.isConnected()).true)
    }
  )

  it.for(fetchAndSse)(
    `should stop fetching and report an error if response is missing required headers (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
      })

      const unsub = shapeStream.subscribe(() => unsub())
      expect(shapeStream.isConnected()).false

      await vi.waitFor(() => {
        const expectedErrorMessage = new MissingHeadersError(url, [
          `electric-handle`,
          `electric-schema`,
        ]).message
        expect(error1!.message).equals(expectedErrorMessage)
        expect((shapeStream.error as Error).message).equals(
          expectedErrorMessage
        )
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
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should set isConnected to false after fetch if not subscribed (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        subscribe: false,
        experimentalLiveSse,
        signal: aborter.signal,
      })

      await waitForFetch(shapeStream)

      // We should no longer be connected because
      // the initial fetch finished and we've not subscribed to changes
      await vi.waitFor(() => expect(shapeStream.isConnected()).false)
    }
  )

  it.for(fetchAndSse)(
    `should expose isLoading status (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
      })

      expect(shapeStream.isLoading()).true

      await waitForFetch(shapeStream)

      expect(shapeStream.isLoading()).false
    }
  )

  it.for(fetchAndSse)(
    `should expose lastOffset (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
      })
      const shape = new Shape(shapeStream)

      expect(shapeStream.lastOffset).toBe(`-1`)
      expect(shape.lastOffset).toBe(shapeStream.lastOffset)
      await waitForFetch(shapeStream)

      shape.unsubscribeAll()
    }
  )

  it.for(fetchAndSse)(
    `should honour replica: full (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      { issuesTableUrl, insertIssues, updateIssue, clearIssuesShape, aborter }
    ) => {
      const [id] = await insertIssues({ title: `first title` })

      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
          replica: `full`,
        },
        experimentalLiveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should support function-based params and headers (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
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
        experimentalLiveSse,
        signal: aborter.signal,
      })
      const shape2 = new Shape(shapeStream2)
      await shape2.value

      expect(mockAsyncParamFn).toHaveBeenCalled()
      expect(mockAsyncHeaderFn).toHaveBeenCalled()

      // Verify the resolved values
      expect(await resolveValue(mockParamFn())).toBe(`test-value`)
      expect(await resolveValue(mockAsyncParamFn())).toBe(`test-value`)
    }
  )

  it.for(fetchAndSse)(
    `should support forceDisconnectAndRefresh() to force a sync (liveSSE=$experimentalLiveSse)`,
    async (
      { experimentalLiveSse },
      { issuesTableUrl, insertIssues, updateIssue, waitForIssues, aborter }
    ) => {
      // Create initial data
      const [id] = await insertIssues({ title: `initial title` })
      await waitForIssues({ numChangesExpected: 1 })

      // Track fetch requests
      let pendingRequests: Array<
        [string | URL | Request, () => Promise<void>]
      > = []

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
        experimentalLiveSse,
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
    }
  )
})

describe(`Shape - backwards compatible`, () => {
  it.for(fetchAndSse)(
    `should set isConnected to false on fetch error and back on true when fetch succeeds again (liveSSE=$experimentalLiveSse)`,
    async ({ experimentalLiveSse }, { issuesTableUrl, aborter }) => {
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
        experimentalLiveSse,
      })

      const unsubscribe = shapeStream.subscribe(() => unsubscribe())

      await vi.waitFor(() => expect(shapeStream.isConnected()).true)
      expect(shapeStream.lastSyncedAt()).closeTo(Date.now(), 200)

      await sleep(400)

      expect(shapeStream.lastSyncedAt()).closeTo(Date.now(), 200)
    }
  )
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
