import { describe, expect, inject, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { ShapeStream, Shape, FetchError } from '../src'

const BASE_URL = inject(`baseUrl`)

describe(`Shape`, () => {
  it(`should sync an empty shape`, async ({ issuesTableUrl }) => {
    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
    })
    const shape = new Shape(shapeStream)
    const map = await shape.value

    expect(map).toEqual(new Map())
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
  })

  it(`should notify with the initial value`, async ({
    issuesTableUrl,
    issuesTableKey,
    insertIssues,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
    })
    const shape = new Shape(shapeStream)

    const map = await new Promise((resolve) => {
      shape.subscribe(resolve)
    })

    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/"${id}"`, {
      id: id,
      title: `test title`,
      priority: 10,
    })

    expect(map).toEqual(expectedValue)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
  })

  it(`should continually sync a shape/table`, async ({
    issuesTableUrl,
    insertIssues,
    deleteIssue,
    updateIssue,
    issuesTableKey,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
    })
    const shape = new Shape(shapeStream)
    const map = await shape.value

    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/"${id}"`, {
      id: id,
      title: `test title`,
      priority: 10,
    })
    expect(map).toEqual(expectedValue)
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

    expectedValue.set(`${issuesTableKey}/"${id2}"`, {
      id: id2,
      title: `new title`,
      priority: 10,
    })
    expect(shape.valueSync).toEqual(expectedValue)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(intermediate)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - intermediate)

    shape.unsubscribeAll()
  })

  it(`should resync from scratch on a shape rotation`, async ({
    issuesTableUrl,
    issuesTableKey,
    insertIssues,
    deleteIssue,
    clearIssuesShape,
    aborter,
  }) => {
    const id1 = uuidv4()
    const id2 = uuidv4()
    await insertIssues({ id: id1, title: `foo1` })

    const expectedValue1 = new Map()
    expectedValue1.set(`${issuesTableKey}/"${id1}"`, {
      id: id1,
      title: `foo1`,
      priority: 10,
    })

    const expectedValue2 = new Map()
    expectedValue2.set(`${issuesTableKey}/"${id2}"`, {
      id: id2,
      title: `foo2`,
      priority: 10,
    })

    let requestsMade = 0
    const start = Date.now()
    let rotationTime: number = Infinity
    const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
      // clear the shape and modify the data after the initial request
      if (requestsMade === 1) {
        // new shape data should have just second issue and not first
        await deleteIssue({ id: id1, title: `foo1` })
        await insertIssues({ id: id2, title: `foo2` })
        await sleep(100)
        await clearIssuesShape(shapeStream.shapeId)

        rotationTime = Date.now()
      }

      requestsMade++
      const response = await fetch(...args)
      return response
    }

    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const shape = new Shape(shapeStream)

    let dataUpdateCount = 0
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(`Timed out waiting for data changes`), 1000)
      shape.subscribe((shapeData) => {
        dataUpdateCount++
        if (dataUpdateCount === 1) {
          expect(shapeData).toEqual(expectedValue1)
          expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)
          return
        } else if (dataUpdateCount === 2) {
          expect(shapeData).toEqual(expectedValue2)
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
    issuesTableKey,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const start = Date.now()
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
    })
    const shape = new Shape(shapeStream)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })

    const [id2] = await insertIssues({ title: `other title` })

    const value = await hasNotified
    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/"${id}"`, {
      id: id,
      title: `test title`,
      priority: 10,
    })
    expectedValue.set(`${issuesTableKey}/"${id2}"`, {
      id: id2,
      title: `other title`,
      priority: 10,
    })
    expect(value).toEqual(expectedValue)
    expect(shape.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(shape.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(shape.lastSynced()).toBeLessThanOrEqual(Date.now() - start)

    shape.unsubscribeAll()
  })

  it(`should support unsubscribe`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
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
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
    })

    await sleep(100) // give some time for the initial fetch to complete
    expect(shapeStream.isConnected()).true

    const shape = new Shape(shapeStream)
    await shape.value

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
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
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
        return new Response(undefined, { status: 204 })
      },
    })

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

  it(`should set isConnected to false after fetch if not subscribed`, async ({
    issuesTableUrl,
  }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: false,
    })

    await sleep(100) // give some time for the fetch to complete

    // We should no longer be connected because
    // the initial fetch finished and we've not subscribed to changes
    expect(shapeStream.isConnected()).false
  })

  it(`should expose isLoading status`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      fetchClient: async (input, init) => {
        await sleep(20)
        return fetch(input, init)
      },
    })

    expect(shapeStream.isLoading()).true

    await sleep(200) // give some time for the initial fetch to complete

    expect(shapeStream.isLoading()).false
  })
})
