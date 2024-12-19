import { describe, expect, inject, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { ShapeStream, Shape, FetchError } from '../src'
import { Message, Row, ChangeMessage } from '../src/types'
import { MissingHeadersError } from '../src/error'
import { resolveValue } from '../src'

const BASE_URL = inject(`baseUrl`)

describe(`Shape`, () => {
  it(`should sync an empty shape`, async ({ issuesTableUrl }) => {
    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
    })
    const shape = new Shape(shapeStream)

    expect(await shape.value).toEqual(new Map())
    expect(await shape.rows).toEqual([])
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
  })

  it(`should throw on a reserved parameter`, async () => {
    expect(() => {
      const shapeStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: `foo`,
          live: `false`,
        },
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

  it(`should continually sync a shape/table`, async ({
    issuesTableUrl,
    insertIssues,
    deleteIssue,
    updateIssue,
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
    })
    const shape = new Shape(shapeStream)
    const rows = await shape.rows

    expect(rows).toEqual(expectedValue1)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)

    await sleep(100)
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
    await sleep(200) // some time for electric to catch up
    await hasNotified

    const expectedValue2 = [
      ...expectedValue1,
      {
        id: id2,
        title: `new title`,
        priority: 10,
      },
    ]

    expect(shape.currentRows).toEqual(expectedValue2)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(intermediate)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - intermediate)

    shape.unsubscribeAll()
  })

  it(`should resync from scratch on a shape rotation`, async ({
    issuesTableUrl,
    insertIssues,
    deleteIssue,
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

    let requestsMade = 0
    const start = Date.now()
    let rotationTime: number = Infinity
    const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
      // clear the shape and modify the data after the initial request
      if (requestsMade === 2) {
        // new shape data should have just second issue and not first
        await deleteIssue({ id: id1, title: `foo1` })
        await insertIssues({ id: id2, title: `foo2` })
        await sleep(100)
        await clearIssuesShape(shapeStream.shapeHandle)

        rotationTime = Date.now()
      }

      requestsMade++
      const response = await fetch(...args)
      return response
    }

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const shape = new Shape(shapeStream)
    let dataUpdateCount = 0
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(`Timed out waiting for data changes`), 1000)
      shape.subscribe(({ rows }) => {
        dataUpdateCount++
        if (dataUpdateCount === 1) {
          expect(rows).toEqual(expectedValue1)
          expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
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

  it(`should support unsubscribe`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
    })
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
    })

    // give some time for the initial fetch to complete
    await waitForFetch(shapeStream)
    expect(shapeStream.isConnected()).true

    const shape = new Shape(shapeStream)
    await shape.rows

    expect(shapeStream.isConnected()).true

    // Abort the shape stream and check connectivity status
    aborter.abort()
    await sleep(100) // give some time for the shape stream to abort

    expect(shapeStream.isConnected()).false
  })

  it(`should set isConnected to false on fetch error and back on true when fetch succeeds again`, async ({
    issuesTableUrl,
  }) => {
    let fetchShouldFail = false
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
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
        return new Response(undefined, {
          status: 204,
          headers: new Headers({
            [`electric-offset`]: `0_0`,
            [`electric-handle`]: `foo`,
            [`electric-schema`]: ``,
          }),
        })
      },
    })

    const unsubscribe = shapeStream.subscribe(() => unsubscribe())

    await sleep(100) // give some time for the initial fetch to complete
    expect(shapeStream.isConnected()).true

    // Now make fetch fail and check the status
    fetchShouldFail = true
    await sleep(20) // give some time for the request to be aborted

    expect(shapeStream.isConnected()).false

    fetchShouldFail = false
    await sleep(200)

    expect(shapeStream.isConnected()).true
  })

  it(`should not throw error if an error handler is provided`, async ({
    issuesTableUrl,
  }) => {
    const mockErrorHandler = vi.fn()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      fetchClient: async (_input, _init) => {
        return new Response(undefined, {
          status: 401,
        })
      },
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
  })

  it(`should retry on error if error handler returns modified params`, async ({
    issuesTableUrl,
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
      fetchClient: async (input, _init) => {
        const url = new URL(input)
        if (url.searchParams.get(`todo`) === `fail`) {
          return new Response(undefined, {
            status: 401,
          })
        }

        return new Response(`[]`, { status: 204 })
      },
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
  })

  it(`should retry on error if error handler returns modified headers`, async ({
    issuesTableUrl,
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
      fetchClient: async (input, init) => {
        const headers = init?.headers as Record<string, string>
        if (headers && headers.Authorization === `valid credentials`) {
          return fetch(input, init)
        }

        return new Response(undefined, {
          status: 401,
        })
      },
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
  })

  it(`should support async error handler`, async ({ issuesTableUrl }) => {
    let authChanged: () => void
    const authChangePromise = new Promise<void>((res) => {
      authChanged = res
    })
    const mockErrorHandler = vi.fn().mockImplementation(async (error) => {
      if (error instanceof FetchError && error.status === 401) {
        await sleep(200)
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
      fetchClient: async (input, init) => {
        const headers = init?.headers as Record<string, string>
        if (headers && headers.Authorization === `valid credentials`) {
          return fetch(input, init)
        }

        return new Response(undefined, {
          status: 401,
        })
      },
      onError: mockErrorHandler,
    })

    await waitForFetch(shapeStream)
    expect(mockErrorHandler.mock.calls.length).toBe(1)
    expect(mockErrorHandler.mock.calls[0][0]).toBeInstanceOf(FetchError)
    expect(shapeStream.isConnected()).toBe(false)

    await authChangePromise
    await sleep(200) // give some time for the error handler to modify the authorization header
    expect(shapeStream.isConnected()).toBe(true)
  })

  it(`should stop fetching and report an error if response is missing required headers`, async ({
    issuesTableUrl,
  }) => {
    let url: string = ``
    let error1: Error, error2: Error

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      fetchClient: async (input, _init) => {
        url = input.toString()
        const headers = new Headers()
        headers.set(`electric-offset`, `0_0`)
        return new Response(``, { status: 200, headers })
      },
      onError: (err) => {
        error1 = err
      },
    })

    const unsub = shapeStream.subscribe(() => unsub())
    await sleep(10) // give sometime for fetch to fail

    expect(shapeStream.isConnected()).false

    const expectedErrorMessage = new MissingHeadersError(url, [
      `electric-handle`,
      `electric-schema`,
    ]).message

    expect(error1!.message).equals(expectedErrorMessage)
    expect((shapeStream.error as Error).message).equals(expectedErrorMessage)

    // Also check that electric-cursor is a required header for responses to live queries
    const shapeStreamLive = new ShapeStream({
      url: `${BASE_URL}/v1/shape?live=true`,
      params: {
        table: issuesTableUrl,
      },
      fetchClient: async (input, _init) => {
        url = input.toString()
        const headers = new Headers()
        headers.set(`electric-offset`, `0_0`)
        return new Response(undefined, { status: 200, headers })
      },
      onError: (err) => {
        error2 = err
      },
    })

    const unsubLive = shapeStreamLive.subscribe(() => unsubLive())
    await sleep(10) // give some time for the initial fetch to complete
    expect(shapeStreamLive.isConnected()).false

    const expectedErrorMessageLive = new MissingHeadersError(url, [
      `electric-handle`,
      `electric-cursor`,
    ]).message
    expect(error2!.message).equals(expectedErrorMessageLive)
    expect((shapeStreamLive.error as Error).message).equals(
      expectedErrorMessageLive
    )
  })

  it(`should set isConnected to false after fetch if not subscribed`, async ({
    issuesTableUrl,
  }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      subscribe: false,
    })

    await waitForFetch(shapeStream)
    await sleep(50)

    // We should no longer be connected because
    // the initial fetch finished and we've not subscribed to changes
    expect(shapeStream.isConnected()).false
  })

  it(`should expose isLoading status`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      fetchClient: async (input, init) => {
        await sleep(20)
        return fetch(input, init)
      },
    })

    expect(shapeStream.isLoading()).true

    await waitForFetch(shapeStream)

    expect(shapeStream.isLoading()).false
  })

  it(`should expose lastOffset`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape`,
      params: {
        table: issuesTableUrl,
      },
      fetchClient: async (input, init) => {
        await sleep(20)
        return fetch(input, init)
      },
    })
    const shape = new Shape(shapeStream)

    expect(shapeStream.lastOffset).toBe(`-1`)
    expect(shape.lastOffset).toBe(shapeStream.lastOffset)

    shape.unsubscribeAll()
  })

  it(`should honour replica: full`, async ({
    insertIssues,
    updateIssue,
    issuesTableUrl,
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
      signal: aborter.signal,
    })
    try {
      await new Promise((resolve) => {
        shapeStream.subscribe(resolve)
      })

      await sleep(200)
      await updateIssue({ id: id, title: `updated title` })

      const msgs: Message<Row>[] = await new Promise((resolve) => {
        shapeStream.subscribe(resolve)
      })

      const expectedValue = {
        id: id,
        title: `updated title`,
        // because we're sending the full row, the update will include the
        // unchanged `priority` column
        priority: 10,
      }

      const changeMsg: ChangeMessage<Row> = msgs[0] as ChangeMessage<Row>
      expect(changeMsg.headers.operation).toEqual(`update`)
      expect(changeMsg.value).toEqual(expectedValue)
    } finally {
      // the normal cleanup doesn't work because our shape definition is
      // changed by the updates: 'full' param
      await clearIssuesShape(shapeStream.shapeHandle)
    }
  })

  it(`should support function-based params and headers`, async ({
    issuesTableUrl,
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
    })
    const shape2 = new Shape(shapeStream2)
    await shape2.value

    expect(mockAsyncParamFn).toHaveBeenCalled()
    expect(mockAsyncHeaderFn).toHaveBeenCalled()

    // Verify the resolved values
    expect(await resolveValue(mockParamFn())).toBe(`test-value`)
    expect(await resolveValue(mockAsyncParamFn())).toBe(`test-value`)
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
