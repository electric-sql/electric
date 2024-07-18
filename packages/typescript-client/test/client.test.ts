import { ArgumentsType, describe, expect, inject, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { ShapeStream, Shape } from '../src/client'

const BASE_URL = inject(`baseUrl`)

describe(`Shape`, () => {
  it(`should sync an empty shape`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
    })
    const shape = new Shape(shapeStream)
    const map = await shape.value

    expect(map).toEqual(new Map())
  })

  it(`should notify with the initial value`, async ({
    issuesTableUrl,
    issuesTableKey,
    insertIssues,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
      signal: aborter.signal,
    })
    const shape = new Shape(shapeStream)

    const map = await new Promise((resolve) => {
      shape.subscribe(resolve)
    })

    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/${id}`, {
      id: id,
      title: `test title`,
    })

    expect(map).toEqual(expectedValue)
  })

  it(`should continually sync a shape/table`, async ({
    issuesTableUrl,
    insertIssues,
    deleteIssue,
    issuesTableKey,
    aborter,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
      signal: aborter.signal,
    })
    const shape = new Shape(shapeStream)
    const map = await shape.value

    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/${id}`, {
      id: id,
      title: `test title`,
    })
    expect(map).toEqual(expectedValue)

    // FIXME: might get notified before all changes are submitted
    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    const [id2] = await insertIssues({ title: `other title` })
    const [id3] = await insertIssues({ title: `other title2` })
    await deleteIssue({ id: id3, title: `other title2` })
    await sleep(100) // some time for electric to catch up
    await hasNotified

    expectedValue.set(`${issuesTableKey}/${id2}`, {
      id: id2,
      title: `other title`,
    })
    expect(shape.valueSync).toEqual(expectedValue)

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
    expectedValue1.set(`${issuesTableKey}/${id1}`, {
      id: id1,
      title: `foo1`,
    })

    const expectedValue2 = new Map()
    expectedValue2.set(`${issuesTableKey}/${id2}`, {
      id: id2,
      title: `foo2`,
    })

    let requestsMade = 0
    const fetchWrapper = async (...args: ArgumentsType<typeof fetch>) => {
      // clear the shape and modify the data after the initial request
      if (requestsMade === 1) {
        await clearIssuesShape()
        // new shape data should have just second issue and not first
        await deleteIssue({ id: id1, title: `foo1` })
        await insertIssues({ id: id2, title: `foo2` })
      }

      const response = await fetch(...args)
      requestsMade++
      return response
    }

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      subscribe: true,
      baseUrl: BASE_URL,
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
          return
        } else if (dataUpdateCount === 2) {
          expect(shapeData).toEqual(expectedValue2)
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

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
      signal: aborter.signal,
    })
    const shape = new Shape(shapeStream)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })

    const [id2] = await insertIssues({ title: `other title` })

    const value = await hasNotified
    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/${id}`, {
      id: id,
      title: `test title`,
    })
    expectedValue.set(`${issuesTableKey}/${id2}`, {
      id: id2,
      title: `other title`,
    })
    expect(value).toEqual(expectedValue)

    shape.unsubscribeAll()
  })

  it(`should support unsubscribe`, async ({ issuesTableUrl }) => {
    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
    })
    const shape = new Shape(shapeStream)

    const subFn = vi.fn((_) => void 0)

    const unsubscribeFn = shape.subscribe(subFn)
    unsubscribeFn()

    expect(shape.numSubscribers).toBe(0)
    expect(subFn).not.toHaveBeenCalled()
  })
})
