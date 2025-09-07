import { SnapshotMetadata, Row } from './types'
import { ChangeMessage } from './types'

/**
 * Determines if a change message should be filtered based on active snapshots
 * Returns true if the message should be filtered out (not processed)
 */
export class SnapshotTracker {
  private activeSnapshots: Map<
    number,
    { xmin: number; xmax: number; xip: number[]; keys: Set<string> }
  > = new Map()
  private xmaxSnapshots: Map<number, Set<number>> = new Map()
  private snapshotsByDatabaseLsn: Map<bigint, Set<number>> = new Map()

  /**
   * Add a new snapshot for tracking
   */
  addSnapshot(metadata: SnapshotMetadata, keys: Set<string>): void {
    this.activeSnapshots.set(metadata.snapshot_mark, {
      xmin: metadata.xmin,
      xmax: metadata.xmax,
      xip: metadata.xip,
      keys,
    })
    const xmaxSet =
      this.xmaxSnapshots.get(metadata.xmax)?.add(metadata.snapshot_mark) ??
      new Set([metadata.snapshot_mark])
    this.xmaxSnapshots.set(metadata.xmax, xmaxSet)
    const databaseLsnSet =
      this.snapshotsByDatabaseLsn
        .get(BigInt(metadata.database_lsn))
        ?.add(metadata.snapshot_mark) ?? new Set([metadata.snapshot_mark])
    this.snapshotsByDatabaseLsn.set(
      BigInt(metadata.database_lsn),
      databaseLsnSet
    )
  }

  /**
   * Remove a snapshot from tracking
   */
  removeSnapshot(snapshotMark: number): void {
    this.activeSnapshots.delete(snapshotMark)
  }

  /**
   * Check if a change message should be filtered based on active snapshots
   * Returns true if the message should be filtered out (not processed)
   */
  shouldRejectMessage(message: ChangeMessage<any>): boolean {
    const txids = message.headers.txids || []
    if (txids.length === 0) return false

    const xid = Math.max(...txids) // Use the maximum transaction ID

    for (const [xmax, snapshots] of this.xmaxSnapshots.entries()) {
      if (xid >= xmax) {
        for (const snapshot of snapshots) {
          this.removeSnapshot(snapshot)
        }
      }
    }

    // If this change is skippable via any snapshot, skip it.
    for (const { xmin, xmax, xip, keys } of this.activeSnapshots.values()) {
      if (!keys.has(message.key)) continue
      if (xid < xmin) return true
      if (xid < xmax && !xip.includes(xid)) return true
      if (xid < xmax) continue
      if (xid >= xmax) continue
    }

    return false
  }

  lastSeenUpdate(newDatabaseLsn: bigint): void {
    for (const [dbLsn, snapshots] of this.snapshotsByDatabaseLsn.entries()) {
      if (dbLsn <= newDatabaseLsn) {
        for (const snapshot of snapshots) {
          this.removeSnapshot(snapshot)
        }
      }
    }
  }
}
