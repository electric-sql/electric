import { describe, expect, inject, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { testWithIssuesTable as it } from "./support/test-context"
import {
  MultiShapeStream,
  TransactionalMultiShapeStream,
} from "../src/multi-shape-stream"
import { Row } from "@electric-sql/client"
import type { MultiShapeMessages } from "../src/multi-shape-stream"
import { v4 as uuidv4 } from "uuid"

const BASE_URL = inject("baseUrl")

interface IssueRow extends Row {
  id: string
  title: string
  priority: number
}

describe("MultiShapeStream", () => {
  it("should sync multiple empty shapes", async ({
    issuesTableUrl,
    clearIssuesShape,
    aborter,
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
            where: "priority <= 10",
          },
          signal: aborter.signal,
        },
        shape2: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority > 10",
          },
          signal: aborter.signal,
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
  })

  it("should notify with initial values from multiple shapes", async ({
    issuesTableUrl,
    insertIssues,
    aborter,
  }) => {
    const [id1] = await insertIssues({ title: "test title 1", priority: 5 })
    const [id2] = await insertIssues({ title: "test title 2", priority: 15 })

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
            where: "priority <= 10",
          },
          signal: aborter.signal,
        },
        highPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority > 10",
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
        "value" in msg
    )

    // Find messages for each shape
    const lowPriorityMsg = changeMessages.find(
      (msg) => msg.shape === "lowPriority"
    )
    const highPriorityMsg = changeMessages.find(
      (msg) => msg.shape === "highPriority"
    )

    expect(lowPriorityMsg?.value).toEqual({
      id: id1,
      title: "test title 1",
      priority: 5,
    })

    expect(highPriorityMsg?.value).toEqual({
      id: id2,
      title: "test title 2",
      priority: 15,
    })

    expect(multiShapeStream.lastSyncedAt()).toBeGreaterThanOrEqual(start)
    expect(multiShapeStream.lastSyncedAt()).toBeLessThanOrEqual(Date.now())
    expect(multiShapeStream.lastSynced()).toBeLessThanOrEqual(
      Date.now() - start
    )
  })

  it("should continually sync multiple shapes", async ({
    issuesTableUrl,
    insertIssues,
    updateIssue,
    waitForIssues,
    aborter,
  }) => {
    const [id1] = await insertIssues({ title: "test title 1", priority: 5 })
    const [id2] = await insertIssues({ title: "test title 2", priority: 15 })
    const streamState = await waitForIssues({ numChangesExpected: 2 })

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
            where: "priority <= 10",
          },
          signal: aborter.signal,
        },
        highPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority > 10",
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
    await updateIssue({ id: id1, title: "low priority", priority: 20 })
    // Update that moves an issue from high to low priority
    await updateIssue({ id: id2, title: "high priority", priority: 5 })

    // some time for electric to catch up
    await waitForIssues({
      numChangesExpected: 2,
      shapeStreamOptions: streamState,
    })

    // Verify we got update messages for both shapes
    const [lowPriorityMsgs, highPriorityMsgs] = await vi.waitFor(() => {
      const changeMessages = (
        messages as MultiShapeMessages<ShapeConfig>[]
      ).filter(
        (msg): msg is MultiShapeMessages<ShapeConfig> & { value: IssueRow } =>
          "value" in msg
      )

      // Should have updates in both shapes
      const lowPriorityMsgs = changeMessages.filter(
        (msg) => msg.shape === "lowPriority"
      )
      const highPriorityMsgs = changeMessages.filter(
        (msg) => msg.shape === "highPriority"
      )

      expect(lowPriorityMsgs.length).toBe(3)
      expect(highPriorityMsgs.length).toBe(3)
      return [lowPriorityMsgs, highPriorityMsgs]
    })

    expect(
      lowPriorityMsgs.filter((msg) => msg.headers.operation === "insert").length
    ).toBe(2)
    expect(
      lowPriorityMsgs.filter((msg) => msg.headers.operation === "delete").length
    ).toBe(1)

    expect(
      highPriorityMsgs.filter((msg) => msg.headers.operation === "insert")
        .length
    ).toBe(2)
    expect(
      highPriorityMsgs.filter((msg) => msg.headers.operation === "delete")
        .length
    ).toBe(1)
  })

  it("should support unsubscribe", async ({
    issuesTableUrl,
    insertIssues,
    waitForIssues,
    aborter,
  }) => {
    const multiShapeStream = new MultiShapeStream<{
      shape1: IssueRow
    }>({
      shapes: {
        shape1: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
        },
      },
    })

    const subFn = vi.fn((_) => void 0)
    const unsubscribeFn = multiShapeStream.subscribe(subFn)

    // Wait for initial sync
    // await sleep(100)
    await vi.waitFor(() => expect(subFn).toHaveBeenCalledTimes(2))

    unsubscribeFn()
    multiShapeStream.unsubscribeAll()

    // Make a change and verify callback isn't called
    await insertIssues({ title: "test title 1", priority: 5 })
    await waitForIssues({ numChangesExpected: 1 })
    await sleep(100)
    expect(subFn).toHaveBeenCalledTimes(2) // Only the initial sync
  })
})

describe("TransactionalMultiShapeStream", () => {
  it("should group changes from the same transaction together", async ({
    issuesTableUrl,
    insertIssues,
    updateIssue,
    waitForIssues,
    beginTransaction,
    commitTransaction,
    aborter,
  }) => {
    // Create initial data
    const id1 = uuidv4()
    const id2 = uuidv4()
    const id3 = uuidv4()
    await insertIssues({ id: id1, title: "test title 1", priority: 5 })
    await insertIssues({ id: id2, title: "test title 2", priority: 15 })
    const streamState = await waitForIssues({ numChangesExpected: 2 })

    type ShapeConfig = {
      lowPriority: IssueRow
      highPriority: IssueRow
    }

    const multiShapeStream = new TransactionalMultiShapeStream<ShapeConfig>({
      shapes: {
        lowPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority <= 10",
          },
          signal: aborter.signal,
        },
        highPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority > 10",
          },
          signal: aborter.signal,
        },
      },
    })

    const messageGroups: MultiShapeMessages<ShapeConfig>[][] = []

    // Subscribe and wait for initial sync
    await new Promise<void>((resolve) => {
      multiShapeStream.subscribe((msgs: MultiShapeMessages<ShapeConfig>[]) => {
        messageGroups.push(msgs)
        if (multiShapeStream.isUpToDate) {
          resolve()
        }
      })
    })

    // We should get one message group containing all changes from the initial sync
    expect(messageGroups.length).toBe(1)
    const initialSyncGroup = messageGroups[0]
    expect(initialSyncGroup.length).toBe(2)
    expect(initialSyncGroup.every((msg) => "value" in msg)).toBe(true)

    // Clear initial sync messages
    messageGroups.length = 0

    // Transaction that will affect both shapes
    await beginTransaction()
    await updateIssue({ id: id1, title: "moved to high", priority: 20 })
    await updateIssue({ id: id2, title: "moved to low", priority: 5 })
    await insertIssues({ id: id3, title: "test title 3", priority: 20 })
    await commitTransaction()

    // Wait for changes to be processed
    await waitForIssues({
      numChangesExpected: 3,
      shapeStreamOptions: streamState,
    })

    // We should get one message group containing all changes from the transaction
    await vi.waitFor(() => expect(messageGroups.length).toBe(1))

    // Find the message group containing our changes
    const changeGroup = messageGroups.find((group) =>
      group.some(
        (msg) =>
          "value" in msg && (msg.value.id === id1 || msg.value.id === id2)
      )
    )

    expect(changeGroup).toBeDefined()
    expect(changeGroup!.length).toBe(5)
    // 2 deletes + 2 inserts for the moves
    // + 1 insert for the new issue

    // Verify the operations are in the correct order based on op_position
    const operations = changeGroup!
      .filter(
        (msg): msg is MultiShapeMessages<ShapeConfig> & { value: IssueRow } =>
          "value" in msg
      )
      .map((msg) => ({
        operation: msg.headers.operation,
        shape: msg.shape,
        id: msg.value.id,
      }))

    // Verify we have the expected sequence of operations
    expect(operations).toContainEqual({
      operation: "delete",
      shape: "lowPriority",
      id: id1,
    })
    expect(operations).toContainEqual({
      operation: "insert",
      shape: "highPriority",
      id: id1,
    })
    expect(operations).toContainEqual({
      operation: "delete",
      shape: "highPriority",
      id: id2,
    })
    expect(operations).toContainEqual({
      operation: "insert",
      shape: "lowPriority",
      id: id2,
    })
    expect(operations).toContainEqual({
      operation: "insert",
      shape: "highPriority",
      id: id3,
    })

    // Verify the operations are ordered by op_position
    const opPositions = changeGroup!.map(
      (msg) => msg.headers.op_position as number
    )
    expect(opPositions).toEqual([...opPositions].sort((a, b) => a - b))
  })

  it("should maintain transaction boundaries across multiple transactions", async ({
    issuesTableUrl,
    insertIssues,
    updateIssue,
    waitForIssues,
    beginTransaction,
    commitTransaction,
    aborter,
  }) => {
    // Create initial data
    const id1 = uuidv4()
    const id2 = uuidv4()
    await insertIssues({ id: id1, title: "test title 1", priority: 5 })
    await insertIssues({ id: id2, title: "test title 2", priority: 15 })
    const streamState = await waitForIssues({ numChangesExpected: 2 })

    type ShapeConfig = {
      lowPriority: IssueRow
      highPriority: IssueRow
    }

    const multiShapeStream = new TransactionalMultiShapeStream<ShapeConfig>({
      shapes: {
        lowPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority <= 10",
          },
          signal: aborter.signal,
        },
        highPriority: {
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: "priority > 10",
          },
          signal: aborter.signal,
        },
      },
    })

    const messageGroups: MultiShapeMessages<ShapeConfig>[][] = []

    // Subscribe and wait for initial sync
    await new Promise<void>((resolve) => {
      multiShapeStream.subscribe((msgs: MultiShapeMessages<ShapeConfig>[]) => {
        messageGroups.push(msgs)
        if (multiShapeStream.isUpToDate) {
          resolve()
        }
      })
    })

    // Clear initial sync messages
    messageGroups.length = 0

    // Perform two separate transactions
    // Transaction 1: Move id1 to high priority
    await beginTransaction()
    await updateIssue({ id: id1, title: "moved to high", priority: 20 })
    await commitTransaction()

    await sleep(50)

    // Transaction 2: Move id2 to low priority
    await beginTransaction()
    await updateIssue({ id: id2, title: "moved to low", priority: 5 })
    await commitTransaction()

    // Wait for changes to be processed
    await waitForIssues({
      numChangesExpected: 2,
      shapeStreamOptions: streamState,
    })
    await sleep(200)

    // Find message groups containing our changes
    const changeGroups = await vi.waitFor(() => {
      const changeGroups = messageGroups.filter((group) =>
        group.some(
          (msg) =>
            "value" in msg && (msg.value.id === id1 || msg.value.id === id2)
        )
      )

      // We should have two separate transaction groups
      expect(changeGroups.length).toBe(2)
      return changeGroups
    })

    // First transaction group should contain operations for id1
    const transaction1 = changeGroups[0]
    expect(transaction1.length).toBe(2) // 1 delete + 1 insert
    expect(
      transaction1.every((msg) => !("value" in msg) || msg.value.id === id1)
    ).toBe(true)

    // Second transaction group should contain operations for id2
    const transaction2 = changeGroups[1]
    expect(transaction2.length).toBe(2) // 1 delete + 1 insert
    expect(
      transaction2.every((msg) => !("value" in msg) || msg.value.id === id2)
    ).toBe(true)

    // Verify LSNs are different between transactions
    const lsn1 = transaction1[0].headers.lsn
    const lsn2 = transaction2[0].headers.lsn
    expect(lsn1).not.toBe(lsn2)

    // Verify operations within each transaction are ordered by op_position
    const verifyOpPositionOrder = (
      group: MultiShapeMessages<ShapeConfig>[]
    ) => {
      const opPositions = group.map((msg) => msg.headers.op_position as number)
      expect(opPositions).toEqual([...opPositions].sort((a, b) => a - b))
    }

    verifyOpPositionOrder(transaction1)
    verifyOpPositionOrder(transaction2)
  })
})
