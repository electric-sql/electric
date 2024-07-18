import { describe, expect, inject, vi } from 'vitest'
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
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
    })
    const shape = new Shape(shapeStream)

    const map = await new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    // shape.()

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
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
    })
    const shape = new Shape(shapeStream)
    const map = await shape.value

    const expectedValue = new Map()
    expectedValue.set(`${issuesTableKey}/${id}`, {
      id: id,
      title: `test title`,
    })
    expect(map).toEqual(expectedValue)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    const [id2] = await insertIssues({ title: `other title` })
    const [id3] = await insertIssues({ title: `other title2` })
    await deleteIssue({ id: id3, title: `foo` })
    await hasNotified

    expectedValue.set(`${issuesTableKey}/${id2}`, {
      id: id2,
      title: `other title`,
    })
    expect(shape.valueSync).toEqual(expectedValue)

    shape.unsubscribeAll()
  })

  it(`should notify subscribers when the value changes`, async ({
    issuesTableUrl,
    insertIssues,
    issuesTableKey,
  }) => {
    const [id] = await insertIssues({ title: `test title` })

    const shapeStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: BASE_URL,
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
