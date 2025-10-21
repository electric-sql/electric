import { beforeEach, describe, expect, it } from "vitest"
import { SnapshotTracker } from "../src/snapshot-tracker"
import { ChangeMessage, SnapshotMetadata, Row } from "../src/types"

describe("SnapshotTracker", () => {
  let tracker: SnapshotTracker

  beforeEach(() => {
    tracker = new SnapshotTracker()
  })

  describe("Single snapshot filtering logic", () => {
    it("should reject message when xid < xmin (already included in snapshot)", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [50], // xid < xmin (50 < 100)
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(true)
    })

    it("should reject message when xid < xmax AND xid not in xip (already included in snapshot)", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: ["150", "175"], // xid 100 is not in xip
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "update",
          txids: [100], // xid < xmax (100 < 200) AND not in xip
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(true)
    })

    it("should NOT reject message when xid < xmax AND xid is in xip (parallel transaction)", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: ["100", "150"], // xid 100 is in xip
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "update",
          txids: [100], // xid < xmax (100 < 200) AND in xip (parallel)
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(false)
    })

    it("should NOT reject message when xid >= xmax (not included in snapshot)", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [250], // xid >= xmax (250 >= 200)
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(false)
    })
  })

  describe("Keys not in snapshots are always let through", () => {
    it("should NOT reject message when key is not in any snapshot", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1", "user:2"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:3", // Key not in snapshot
        value: { id: 3, name: "Charlie" },
        headers: {
          operation: "insert",
          txids: [50], // Would be rejected if key was in snapshot
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(false)
    })

    it("should reject message when key is in snapshot but txid condition met", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1", // Key is in snapshot
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [50], // xid < xmin, should be rejected
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(true)
    })
  })

  describe("Multiple snapshots logic", () => {
    it("should reject message if included in ANY snapshot", () => {
      const snapshot1: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: ["170"],
        database_lsn: "123",
      }
      const snapshot2: SnapshotMetadata = {
        snapshot_mark: 2,
        xmin: "300",
        xmax: "400",
        xip_list: [],
        database_lsn: "456",
      }
      const keys1 = new Set(["user:1", "user:2"])

      tracker.addSnapshot(snapshot1, keys1)
      tracker.addSnapshot(snapshot2, keys1)

      // Message that would be included in snapshot2 (xid < xmin)
      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1", // In snapshot1
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [170], // xid < xmin of snapshot2 and in xip of snapshot1
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(true)
    })

    it("should NOT reject message if not included in ANY snapshot", () => {
      const snapshot1: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const snapshot2: SnapshotMetadata = {
        snapshot_mark: 2,
        xmin: "300",
        xmax: "400",
        xip_list: [],
        database_lsn: "456",
      }
      const keys1 = new Set(["user:1"])
      const keys2 = new Set(["user:3"])

      tracker.addSnapshot(snapshot1, keys1)
      tracker.addSnapshot(snapshot2, keys2)

      // Message that is not included in either snapshot
      const message: ChangeMessage<Row<unknown>> = {
        key: "user:2", // Not in any snapshot
        value: { id: 2, name: "Bob" },
        headers: {
          operation: "insert",
          txids: [50], // xid < xmin of snapshot1
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(false)
    })
  })

  describe("Snapshot cleanup when xid >= xmax", () => {
    it("should remove snapshot when xid >= xmax", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [250], // xid >= xmax (250 >= 200)
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(false)

      // After processing a message with xid >= xmax, the snapshot should be removed
      // So a subsequent message with xid < xmin should NOT be rejected
      const subsequentMessage: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [25], // xid < xmin, but snapshot was removed
        },
      }

      expect(tracker.shouldRejectMessage(subsequentMessage)).toBe(false)
    })

    it("should keep other snapshots active when one is cleaned up", () => {
      const snapshot1: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const snapshot2: SnapshotMetadata = {
        snapshot_mark: 2,
        xmin: "300",
        xmax: "400",
        xip_list: [],
        database_lsn: "456",
      }
      const keys1 = new Set(["user:1"])
      const keys2 = new Set(["user:2"])

      tracker.addSnapshot(snapshot1, keys1)
      tracker.addSnapshot(snapshot2, keys2)

      // Message that triggers cleanup of snapshot1 (xid >= xmax of snapshot1)
      const cleanupMessage: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [250], // xid >= xmax of snapshot1
        },
      }

      expect(tracker.shouldRejectMessage(cleanupMessage)).toBe(false)

      // snapshot1 should be removed, but snapshot2 should still be active
      const messageForSnapshot2: ChangeMessage<Row<unknown>> = {
        key: "user:2",
        value: { id: 2, name: "Bob" },
        headers: {
          operation: "insert",
          txids: [250], // xid < xmin of snapshot2
        },
      }

      expect(tracker.shouldRejectMessage(messageForSnapshot2)).toBe(true)
    })
  })

  describe("Multiple snapshots with same xmax cleanup", () => {
    it("should clean up all snapshots with same xmax from one message", () => {
      const snapshot1: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const snapshot2: SnapshotMetadata = {
        snapshot_mark: 2,
        xmin: "60",
        xmax: "200", // Same xmax as snapshot1
        xip_list: [],
        database_lsn: "456",
      }
      const keys1 = new Set(["user:1"])
      const keys2 = new Set(["user:2"])

      tracker.addSnapshot(snapshot1, keys1)
      tracker.addSnapshot(snapshot2, keys2)

      // Message that triggers cleanup of both snapshots (xid >= xmax)
      const cleanupMessage: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [250], // xid >= xmax (250 >= 200)
        },
      }

      expect(tracker.shouldRejectMessage(cleanupMessage)).toBe(false)

      // Both snapshots should be removed
      const message1: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [25], // xid < xmin of snapshot1
        },
      }

      const message2: ChangeMessage<Row<unknown>> = {
        key: "user:2",
        value: { id: 2, name: "Bob" },
        headers: {
          operation: "insert",
          txids: [30], // xid < xmin of snapshot2
        },
      }

      expect(tracker.shouldRejectMessage(message1)).toBe(false)
      expect(tracker.shouldRejectMessage(message2)).toBe(false)
    })
  })

  describe("Edge cases and additional functionality", () => {
    it("should handle messages with no txids", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          // No txids
        },
      }

      expect(tracker.shouldRejectMessage(message)).toBe(false)
    })

    it("should handle messages with multiple txids (uses maximum)", () => {
      const metadata: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "100",
        xmax: "200",
        xip_list: [],
        database_lsn: "123",
      }
      const keys = new Set(["user:1"])

      tracker.addSnapshot(metadata, keys)

      const message: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [50, 150, 250], // Max is 250
        },
      }

      // 250 >= xmax, so should not be rejected
      expect(tracker.shouldRejectMessage(message)).toBe(false)
    })

    it("should handle lastSeenUpdate method", () => {
      const snapshot1: SnapshotMetadata = {
        snapshot_mark: 1,
        xmin: "50",
        xmax: "200",
        xip_list: [],
        database_lsn: "100",
      }
      const snapshot2: SnapshotMetadata = {
        snapshot_mark: 2,
        xmin: "60",
        xmax: "300",
        xip_list: [],
        database_lsn: "200",
      }
      const keys1 = new Set(["user:1"])
      const keys2 = new Set(["user:2"])

      tracker.addSnapshot(snapshot1, keys1)
      tracker.addSnapshot(snapshot2, keys2)

      // Update with LSN that removes snapshot1
      tracker.lastSeenUpdate(BigInt(150))

      // snapshot1 should be removed, snapshot2 should remain
      const message1: ChangeMessage<Row<unknown>> = {
        key: "user:1",
        value: { id: 1, name: "Alice" },
        headers: {
          operation: "insert",
          txids: [25], // Would be rejected by snapshot1 if it existed
        },
      }

      const message2: ChangeMessage<Row<unknown>> = {
        key: "user:2",
        value: { id: 2, name: "Bob" },
        headers: {
          operation: "insert",
          txids: [30], // Should still be rejected by snapshot2
        },
      }

      expect(tracker.shouldRejectMessage(message1)).toBe(false)
      expect(tracker.shouldRejectMessage(message2)).toBe(true)
    })
  })
})
