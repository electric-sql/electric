import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Shape } from '../src/shape'
import {
  Message,
  Row,
  ChangeMessage,
  ControlMessage,
  EventMessage,
  MoveOutPattern,
} from '../src/types'
import { ShapeStreamInterface, LogMode } from '../src/client'
import { isEventMessage } from '../src/helpers'

/**
 * Mock ShapeStream implementation for testing
 */
class MockShapeStream<T extends Row<unknown> = Row>
  implements ShapeStreamInterface<T>
{
  subscribers: Array<
    (messages: Message<T>[]) => void | Promise<void> | { columns?: (keyof T)[] }
  > = []
  errorSubscribers: Array<(error: Error) => void> = []
  isUpToDate = false
  lastOffset = `-1` as const
  shapeHandle?: string = `test-handle`
  error?: unknown
  mode: LogMode = `full`

  subscribe(
    callback: (messages: Message<T>[]) => void | Promise<void>,
    onError?: (error: Error) => void
  ): () => void {
    this.subscribers.push(callback)
    if (onError) this.errorSubscribers.push(onError)
    return () => {
      const idx = this.subscribers.indexOf(callback)
      if (idx >= 0) this.subscribers.splice(idx, 1)
      if (onError) {
        const errIdx = this.errorSubscribers.indexOf(onError)
        if (errIdx >= 0) this.errorSubscribers.splice(errIdx, 1)
      }
    }
  }

  unsubscribeAll(): void {
    this.subscribers = []
    this.errorSubscribers = []
  }

  isLoading(): boolean {
    return !this.isUpToDate
  }

  lastSyncedAt(): number | undefined {
    return this.isUpToDate ? Date.now() : undefined
  }

  lastSynced(): number {
    return this.isUpToDate ? 0 : Infinity
  }

  isConnected(): boolean {
    return true
  }

  hasStarted(): boolean {
    return true
  }

  async forceDisconnectAndRefresh(): Promise<void> {
    // Mock implementation
  }

  async requestSnapshot(): Promise<any> {
    return { metadata: {}, data: [] }
  }

  async fetchSnapshot(): Promise<any> {
    return { metadata: {}, data: [] }
  }

  // Helper to send messages to subscribers
  sendMessages(messages: Message<T>[]) {
    this.subscribers.forEach((callback) => callback(messages))
  }

  // Helper to mark stream as up-to-date
  setUpToDate() {
    this.isUpToDate = true
    const upToDateMsg: ControlMessage = {
      headers: { control: `up-to-date` },
    }
    this.sendMessages([upToDateMsg as Message<T>])
  }
}

describe(`Shape - Tag Tracking and Move-Out`, () => {
  describe(`Helper function isEventMessage()`, () => {
    it(`should correctly identify EventMessages`, () => {
      const eventMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      expect(isEventMessage(eventMsg)).toBe(true)
    })

    it(`should return false for ChangeMessages`, () => {
      const changeMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: { operation: `insert` },
      }
      expect(isEventMessage(changeMsg)).toBe(false)
    })

    it(`should return false for ControlMessages`, () => {
      const controlMsg: ControlMessage = {
        headers: { control: `up-to-date` },
      }
      expect(isEventMessage(controlMsg)).toBe(false)
    })
  })

  describe(`Tag tracking - full mode`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
      shape = new Shape(stream)
    })

    it(`should track tags on insert operations`, () => {
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1, name: `test` },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }

      stream.sendMessages([insertMsg])

      expect(shape.currentRows).toHaveLength(1)
      expect(shape.currentRows[0]).toEqual({ id: 1, name: `test` })
    })

    it(`should track multiple tags on a single row`, () => {
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`, `tag2`, `tag3`],
        },
      }

      stream.sendMessages([insertMsg])

      expect(shape.currentRows).toHaveLength(1)
    })

    it(`should update tags on update operations`, () => {
      // First insert with tag1
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1, name: `test` },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])

      // Then update with tag2
      const updateMsg: ChangeMessage = {
        key: `key1`,
        value: { name: `updated` },
        headers: {
          operation: `update`,
          tags: [`tag2`],
        },
      }
      stream.sendMessages([updateMsg])

      expect(shape.currentRows).toHaveLength(1)
      expect(shape.currentRows[0]).toEqual({ id: 1, name: `updated` })
    })

    it(`should remove row when tags become empty after update`, () => {
      // Insert with tag1
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])
      expect(shape.currentRows).toHaveLength(1)

      // Update with empty tags
      const updateMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `update`,
          tags: [],
        },
      }
      stream.sendMessages([updateMsg])

      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should clean up tag indices on delete operations`, () => {
      // Insert with tags
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`, `tag2`],
        },
      }
      stream.sendMessages([insertMsg])

      // Delete the row
      const deleteMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `delete`,
        },
      }
      stream.sendMessages([deleteMsg])

      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should handle rows without tags`, () => {
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
        },
      }

      stream.sendMessages([insertMsg])

      expect(shape.currentRows).toHaveLength(1)
    })
  })

  describe(`Tag tracking - changes_only mode`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `changes_only`
      shape = new Shape(stream)
    })

    it(`should track tags on insert in changes_only mode`, () => {
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }

      stream.sendMessages([insertMsg])

      expect(shape.currentRows).toHaveLength(1)
    })

    it(`should only apply updates to inserted keys in changes_only mode`, () => {
      // Update without prior insert should be ignored
      const updateMsg: ChangeMessage = {
        key: `key1`,
        value: { name: `updated` },
        headers: {
          operation: `update`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([updateMsg])
      expect(shape.currentRows).toHaveLength(0)

      // Insert then update should work
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1, name: `test` },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])

      const updateMsg2: ChangeMessage = {
        key: `key1`,
        value: { name: `updated` },
        headers: {
          operation: `update`,
          tags: [`tag2`],
        },
      }
      stream.sendMessages([updateMsg2])

      expect(shape.currentRows).toHaveLength(1)
      expect(shape.currentRows[0]).toEqual({ id: 1, name: `updated` })
    })

    it(`should only apply deletes to inserted keys in changes_only mode`, () => {
      // Delete without prior insert should be ignored
      const deleteMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `delete`,
        },
      }
      stream.sendMessages([deleteMsg])
      expect(shape.currentRows).toHaveLength(0)
    })
  })

  describe(`Move-out event processing`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
      shape = new Shape(stream)
    })

    it(`should process move-out events and remove affected rows`, () => {
      // Insert two rows with different tags
      const insert1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      const insert2: ChangeMessage = {
        key: `key2`,
        value: { id: 2 },
        headers: {
          operation: `insert`,
          tags: [`tag2`],
        },
      }
      stream.sendMessages([insert1, insert2])
      expect(shape.currentRows).toHaveLength(2)

      // Send move-out event for tag1
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOutMsg])

      // Only key2 should remain
      expect(shape.currentRows).toHaveLength(1)
      expect(shape.currentRows[0]).toEqual({ id: 2 })
    })

    it(`should remove tag from row without deleting row if other tags remain`, () => {
      // Insert row with multiple tags
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`, `tag2`],
        },
      }
      stream.sendMessages([insertMsg])

      // Move-out only tag1
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOutMsg])

      // Row should still exist (it has tag2)
      expect(shape.currentRows).toHaveLength(1)
    })

    it(`should delete row when all tags are removed by move-out`, () => {
      // Insert row with single tag
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])

      // Move-out the only tag
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOutMsg])

      // Row should be deleted
      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should process multiple patterns in single move-out event`, () => {
      // Insert three rows with different tags
      const insert1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      const insert2: ChangeMessage = {
        key: `key2`,
        value: { id: 2 },
        headers: {
          operation: `insert`,
          tags: [`tag2`],
        },
      }
      const insert3: ChangeMessage = {
        key: `key3`,
        value: { id: 3 },
        headers: {
          operation: `insert`,
          tags: [`tag3`],
        },
      }
      stream.sendMessages([insert1, insert2, insert3])
      expect(shape.currentRows).toHaveLength(3)

      // Move-out tag1 and tag2
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [
            { pos: 0, value: `tag1` },
            { pos: 0, value: `tag2` },
          ],
        },
      }
      stream.sendMessages([moveOutMsg])

      // Only key3 should remain
      expect(shape.currentRows).toHaveLength(1)
      expect(shape.currentRows[0]).toEqual({ id: 3 })
    })

    it(`should handle move-out for non-existent tags gracefully`, () => {
      // Insert row with tag1
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])

      // Move-out non-existent tag
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `non-existent-tag` }],
        },
      }
      stream.sendMessages([moveOutMsg])

      // Row should still exist
      expect(shape.currentRows).toHaveLength(1)
    })

    it(`should work in changes_only mode`, () => {
      stream.mode = `changes_only`

      // Insert row with tag
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])

      // Move-out
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOutMsg])

      expect(shape.currentRows).toHaveLength(0)
    })
  })

  describe(`Error handling for wildcards and tuple length`, () => {
    let stream: MockShapeStream

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
    })

    it(`should throw error for move-out pattern for tag position other than 0`, () => {
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [
            { pos: 0, value: `tag1` },
            { pos: 1, value: `tag2` },
          ],
        },
      }

      expect(() => stream.sendMessages([moveOutMsg])).toThrow(
        `Only 1-width tags are currently supported`
      )
    })
  })

  describe(`State management with must-refetch`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
      shape = new Shape(stream)
    })

    it(`should clear tag indices on must-refetch`, () => {
      // Insert rows with tags
      const insert1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      const insert2: ChangeMessage = {
        key: `key2`,
        value: { id: 2 },
        headers: {
          operation: `insert`,
          tags: [`tag2`],
        },
      }
      stream.sendMessages([insert1, insert2])
      expect(shape.currentRows).toHaveLength(2)

      // Send must-refetch
      const mustRefetchMsg: ControlMessage = {
        headers: { control: `must-refetch` },
      }
      stream.sendMessages([mustRefetchMsg])

      // All data should be cleared
      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should rebuild tag indices after must-refetch`, () => {
      // Insert initial data
      const insert1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insert1])

      // Must-refetch
      const mustRefetchMsg: ControlMessage = {
        headers: { control: `must-refetch` },
      }
      stream.sendMessages([mustRefetchMsg])
      expect(shape.currentRows).toHaveLength(0)

      // Re-insert data
      const insert2: ChangeMessage = {
        key: `key2`,
        value: { id: 2 },
        headers: {
          operation: `insert`,
          tags: [`tag2`],
        },
      }
      stream.sendMessages([insert2])
      expect(shape.currentRows).toHaveLength(1)

      // Move-out should work with new data
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag2` }],
        },
      }
      stream.sendMessages([moveOutMsg])
      expect(shape.currentRows).toHaveLength(0)
    })
  })

  describe(`Subscription notifications`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
      shape = new Shape(stream)
    })

    it(`should notify subscribers on move-out events`, () => {
      const callback = vi.fn()
      shape.subscribe(callback)

      // Insert row
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg, { headers: { control: `up-to-date` } }])

      // Move-out
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOutMsg, { headers: { control: `up-to-date` } }])

      // Should have been called twice: once for insert, once for move-out
      expect(callback).toHaveBeenCalledTimes(2)
    })

    it(`should not notify if move-out doesn't affect any rows`, () => {
      const callback = vi.fn()

      // Insert row
      const insertMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insertMsg])

      // Subscribe after insert
      shape.subscribe(callback)

      // Move-out non-existent tag - should still notify because move-out event was processed
      const moveOutMsg: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag2` }],
        },
      }
      stream.sendMessages([moveOutMsg])

      // Should be called once for the move-out event
      expect(callback).toHaveBeenCalledTimes(0)
    })
  })

  describe(`Integration tests - complex scenarios`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
      shape = new Shape(stream)
    })

    it(`should handle full CRUD lifecycle with tags`, () => {
      // Insert with tags
      const insert: ChangeMessage = {
        key: `key1`,
        value: { id: 1, name: `Alice` },
        headers: {
          operation: `insert`,
          tags: [`tag1`, `tag2`],
        },
      }
      stream.sendMessages([insert])
      expect(shape.currentRows).toHaveLength(1)

      // Update data
      const update: ChangeMessage = {
        key: `key1`,
        value: { name: `Bob` },
        headers: {
          operation: `update`,
          tags: [`tag1`, `tag2`],
        },
      }
      stream.sendMessages([update])
      expect(shape.currentRows[0]).toEqual({ id: 1, name: `Bob` })

      // Move-out one tag
      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOut])
      expect(shape.currentRows).toHaveLength(1) // Still has tag2

      // Delete
      const deleteMsg: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `delete`,
        },
      }
      stream.sendMessages([deleteMsg])
      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should handle multiple rows with overlapping tags`, () => {
      // Insert rows with various tag combinations
      const insert1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`, `tag2`],
        },
      }
      const insert2: ChangeMessage = {
        key: `key2`,
        value: { id: 2 },
        headers: {
          operation: `insert`,
          tags: [`tag2`, `tag3`],
        },
      }
      const insert3: ChangeMessage = {
        key: `key3`,
        value: { id: 3 },
        headers: {
          operation: `insert`,
          tags: [`tag1`, `tag3`],
        },
      }
      stream.sendMessages([insert1, insert2, insert3])
      expect(shape.currentRows).toHaveLength(3)

      // Move-out tag2
      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag2` }],
        },
      }
      stream.sendMessages([moveOut])

      // key1 still has tag1, key2 still has tag3, key3 still has tag1 and tag3
      expect(shape.currentRows).toHaveLength(3)

      // Move-out tag1
      const moveOut2: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOut2])

      // key1 has no tags left (removed), key2 still has tag3, key3 still has tag3
      expect(shape.currentRows).toHaveLength(2)
      const ids = shape.currentRows.map((r) => r.id).sort()
      expect(ids).toEqual([2, 3])
    })

    it(`should handle rapid tag updates`, () => {
      // Insert
      const insert: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insert])

      // Multiple rapid updates changing tags
      const update1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `update`,
          tags: [`tag2`],
        },
      }
      const update2: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `update`,
          tags: [`tag3`],
        },
      }
      const update3: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `update`,
          tags: [`tag4`],
        },
      }
      stream.sendMessages([update1, update2, update3])

      // Row should still exist
      expect(shape.currentRows).toHaveLength(1)

      // Move-out tag4 should remove the row
      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag4` }],
        },
      }
      stream.sendMessages([moveOut])
      expect(shape.currentRows).toHaveLength(0)

      // Move-out tag1, tag2, tag3 should be no-ops
      const moveOut2: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [
            { pos: 0, value: `tag1` },
            { pos: 0, value: `tag2` },
            { pos: 0, value: `tag3` },
          ],
        },
      }
      stream.sendMessages([moveOut2])
      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should handle interleaved operations and move-outs`, () => {
      // Insert key1 with tag1
      const insert1: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insert1])

      // Move-out tag1
      const moveOut1: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOut1])
      expect(shape.currentRows).toHaveLength(0)

      // Insert key2 with tag1 (same tag, different row)
      const insert2: ChangeMessage = {
        key: `key2`,
        value: { id: 2 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insert2])
      expect(shape.currentRows).toHaveLength(1)
      expect(shape.currentRows[0].id).toBe(2)

      // Move-out tag1 again
      const moveOut2: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `tag1` }],
        },
      }
      stream.sendMessages([moveOut2])
      expect(shape.currentRows).toHaveLength(0)
    })
  })

  describe(`Edge cases`, () => {
    let stream: MockShapeStream
    let shape: Shape

    beforeEach(() => {
      stream = new MockShapeStream()
      stream.mode = `full`
      shape = new Shape(stream)
    })

    it(`should handle empty move-out patterns array`, () => {
      const insert: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag1`],
        },
      }
      stream.sendMessages([insert])

      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [] as MoveOutPattern[],
        },
      }
      stream.sendMessages([moveOut])

      // Nothing should change
      expect(shape.currentRows).toHaveLength(1)
    })

    it(`should handle tag with special characters`, () => {
      const insert: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`tag-with-dashes_and_underscores.and.dots`],
        },
      }
      stream.sendMessages([insert])
      expect(shape.currentRows).toHaveLength(1)

      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [
            { pos: 0, value: `tag-with-dashes_and_underscores.and.dots` },
          ],
        },
      }
      stream.sendMessages([moveOut])
      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should handle very long tag values`, () => {
      const longTag = `a`.repeat(1000)
      const insert: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [longTag],
        },
      }
      stream.sendMessages([insert])
      expect(shape.currentRows).toHaveLength(1)

      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: longTag }],
        },
      }
      stream.sendMessages([moveOut])
      expect(shape.currentRows).toHaveLength(0)
    })

    it(`should handle numeric-like tag values as strings`, () => {
      const insert: ChangeMessage = {
        key: `key1`,
        value: { id: 1 },
        headers: {
          operation: `insert`,
          tags: [`123`, `456.789`],
        },
      }
      stream.sendMessages([insert])
      expect(shape.currentRows).toHaveLength(1)

      const moveOut: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `123` }],
        },
      }
      stream.sendMessages([moveOut])
      expect(shape.currentRows).toHaveLength(1) // Still has 456.789

      const moveOut2: EventMessage = {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `456.789` }],
        },
      }
      stream.sendMessages([moveOut2])
      expect(shape.currentRows).toHaveLength(0)
    })
  })
})
