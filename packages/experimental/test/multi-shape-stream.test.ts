import { describe, expect, inject, vi } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { MultiShapeStream } from '../src/multi-shape-stream'
import { Row } from '@electric-sql/client'
import type { MultiShapeMessages } from '../src/multi-shape-stream'

const BASE_URL = inject(`baseUrl`)

interface IssueRow extends Row {
  id: string
  title: string
  priority: number
}

describe(`MultiShapeStream`, () => {
  it(`should sync multiple empty shapes`, async ({
    issuesTableUrl,
    clearIssuesShape,
  }) => {
    const start = Date.now()
    const multiShapeStream = new MultiShapeStream<{
      shape1: IssueRow
      shape2: IssueRow
    }>({
      shapes: {
        shape1: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority <= 10`,
          },
        },
        shape2: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority > 10`,
          },
        },
      },
    })

    // Subscribe to start the stream
    const hasNotified = new Promise((resolve) => {
      multiShapeStream.subscribe(resolve)
    })

    await hasNotified
    await clearIssuesShape(multiShapeStream.shapes.shape2.shapeHandle)
    await clearIssuesShape(multiShapeStream.shapes.shape1.shapeHandle)

    expect(multiShapeStream.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(multiShapeStream.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(multiShapeStream.lastSynced()).toBeLessThanOrEqual(
      Date.now() - start
    )
    expect(multiShapeStream.isConnected()).toBe(true)
  })

  it(`should notify with initial values from multiple shapes`, async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    const [id1] = await insertIssues({ title: `test title 1`, priority: 5 })
    const [id2] = await insertIssues({ title: `test title 2`, priority: 15 })

    const start = Date.now()
    type ShapeConfig = {
      lowPriority: IssueRow
      highPriority: IssueRow
    }

    const multiShapeStream = new MultiShapeStream<ShapeConfig>({
      shapes: {
        lowPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority <= 10`,
          },
          signal: aborter.signal,
        },
        highPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority > 10`,
          },
          signal: aborter.signal,
        },
      },
    })

    const messages: MultiShapeMessages<ShapeConfig>[] = []

    await new Promise<void>((resolve) => {
      multiShapeStream.subscribe((msgs) => {
        messages.push(...msgs)
        if (multiShapeStream.isUpToDate) {
          resolve()
        }
      })
    })

    // Verify we get messages from both shapes with correct shape names
    expect(messages.length).toBeGreaterThan(0)
    const changeMessages = messages.filter(
      (msg): msg is MultiShapeMessages<ShapeConfig> & { value: IssueRow } =>
        'value' in msg
    )

    // Find messages for each shape
    const lowPriorityMsg = changeMessages.find(
      (msg) => msg.shape === 'lowPriority'
    )
    const highPriorityMsg = changeMessages.find(
      (msg) => msg.shape === 'highPriority'
    )

    expect(lowPriorityMsg?.value).toEqual({
      id: id1,
      title: `test title 1`,
      priority: 5,
    })

    expect(highPriorityMsg?.value).toEqual({
      id: id2,
      title: `test title 2`,
      priority: 15,
    })

    expect(multiShapeStream.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(multiShapeStream.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(multiShapeStream.lastSynced()).toBeLessThanOrEqual(
      Date.now() - start
    )
  })

  it(`should continually sync multiple shapes`, async ({
    issuesTableUrl,
    insertIssues,
    updateIssue,
    aborter,
  }) => {
    const [id1] = await insertIssues({ title: `test title 1`, priority: 5 })
    const [id2] = await insertIssues({ title: `test title 2`, priority: 15 })

    const start = Date.now()
    type ShapeConfig = {
      lowPriority: IssueRow
      highPriority: IssueRow
    }

    const multiShapeStream = new MultiShapeStream<ShapeConfig>({
      shapes: {
        lowPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority <= 10`,
          },
          signal: aborter.signal,
        },
        highPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority > 10`,
          },
          signal: aborter.signal,
        },
      },
    })

    const messages: MultiShapeMessages<ShapeConfig>[] = []

    await new Promise<void>((resolve) => {
      multiShapeStream.subscribe((msgs) => {
        messages.push(...msgs)
        if (multiShapeStream.isUpToDate) {
          resolve()
        }
      })
    })

    // Update that moves an issue from low to high priority
    await updateIssue({ id: id1, title: 'low priority', priority: 20 })
    // Update that moves an issue from high to low priority
    await updateIssue({ id: id2, title: 'high priority', priority: 5 })

    await sleep(200) // some time for electric to catch up

    // Verify we got update messages for both shapes
    const changeMessages = (
      messages as MultiShapeMessages<ShapeConfig>[]
    ).filter(
      (msg): msg is MultiShapeMessages<ShapeConfig> & { value: IssueRow } =>
        'value' in msg
    )

    // Should have updates in both shapes
    const lowPriorityMsgs = changeMessages.filter(
      (msg) => msg.shape === 'lowPriority'
    )
    const highPriorityMsgs = changeMessages.filter(
      (msg) => msg.shape === 'highPriority'
    )

    expect(lowPriorityMsgs.length).toBe(3)
    expect(highPriorityMsgs.length).toBe(3)

    expect(
      lowPriorityMsgs.filter((msg) => msg.headers.operation === 'insert').length
    ).toBe(2)
    expect(
      lowPriorityMsgs.filter((msg) => msg.headers.operation === 'delete').length
    ).toBe(1)

    expect(
      highPriorityMsgs.filter((msg) => msg.headers.operation === 'insert')
        .length
    ).toBe(2)
    expect(
      highPriorityMsgs.filter((msg) => msg.headers.operation === 'delete')
        .length
    ).toBe(1)
  })

  it(`should support unsubscribe`, async ({ issuesTableUrl }) => {
    const multiShapeStream = new MultiShapeStream<{
      shape1: IssueRow
    }>({
      shapes: {
        shape1: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
        },
      },
    })

    const subFn = vi.fn((_) => void 0)
    const unsubscribeFn = multiShapeStream.subscribe(subFn)

    // Wait for initial sync
    await sleep(100)

    unsubscribeFn()
    multiShapeStream.unsubscribeAll()

    // Make a change and verify callback isn't called
    await sleep(100)
    expect(subFn).toHaveBeenCalledTimes(1) // Only the initial sync
  })

  it(`should expose connection status for all shapes`, async ({ issuesTableUrl }) => {
    const aborter = new AbortController()
    const multiShapeStream = new MultiShapeStream<{
      shape1: IssueRow
      shape2: IssueRow
    }>({
      shapes: {
        shape1: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
        },
        shape2: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: `priority > '10'`,
          },
          signal: aborter.signal,
        },
      },
    })

    // Wait for initial sync
    await new Promise<void>((resolve) => {
      multiShapeStream.subscribe(() => resolve())
    })

    expect(multiShapeStream.isConnected()).toBe(true)

    // Abort the shape stream and check connectivity status
    aborter.abort()
    await sleep(100) // give some time for the shape stream to abort

    expect(multiShapeStream.isConnected()).toBe(false)
  })
})
