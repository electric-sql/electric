import { isVisibleInSnapshot } from './helpers'
import { Row, SnapshotMetadata } from './types'
import { ChangeMessage } from './types'

/**
 * Tracks active snapshots and filters out duplicate change messages that are already included in snapshots.
 *
 * When requesting a snapshot in changes_only mode, we need to track which transactions were included in the
 * snapshot to avoid processing duplicate changes that arrive via the live stream. This class maintains that
 * tracking state and provides methods to:
 *
 * - Add new snapshots for tracking via addSnapshot()
 * - Remove completed snapshots via removeSnapshot()
 * - Check if incoming changes should be filtered via shouldRejectMessage()
 */
export class SnapshotTracker {
  private activeSnapshots: Map<
    number,
    {
      xmin: bigint
      xmax: bigint
      xip_list: bigint[]
      keys: Set<string>
      databaseLsn: bigint
    }
  > = new Map()
  private xmaxSnapshots: Map<bigint, Set<number>> = new Map()
  private snapshotsByDatabaseLsn: Map<bigint, Set<number>> = new Map()

  /**
   * Add a new snapshot for tracking
   */
  addSnapshot(metadata: SnapshotMetadata, keys: Set<string>): void {
    // If this mark already exists, drop its reverse-index entries first
    // so they don't linger with the old (xmax, database_lsn) coordinates.
    this.#detachFromReverseIndexes(metadata.snapshot_mark)

    const xmax = BigInt(metadata.xmax)
    const databaseLsn = BigInt(metadata.database_lsn)
    this.activeSnapshots.set(metadata.snapshot_mark, {
      xmin: BigInt(metadata.xmin),
      xmax,
      xip_list: metadata.xip_list.map(BigInt),
      keys,
      databaseLsn,
    })
    this.#addToSet(this.xmaxSnapshots, xmax, metadata.snapshot_mark)
    this.#addToSet(
      this.snapshotsByDatabaseLsn,
      databaseLsn,
      metadata.snapshot_mark
    )
  }

  /**
   * Remove a snapshot from tracking
   */
  removeSnapshot(snapshotMark: number): void {
    this.#detachFromReverseIndexes(snapshotMark)
    this.activeSnapshots.delete(snapshotMark)
  }

  #detachFromReverseIndexes(snapshotMark: number): void {
    const existing = this.activeSnapshots.get(snapshotMark)
    if (!existing) return
    this.#removeFromSet(this.xmaxSnapshots, existing.xmax, snapshotMark)
    this.#removeFromSet(
      this.snapshotsByDatabaseLsn,
      existing.databaseLsn,
      snapshotMark
    )
  }

  #addToSet(map: Map<bigint, Set<number>>, key: bigint, value: number): void {
    const set = map.get(key)
    if (set) {
      set.add(value)
    } else {
      map.set(key, new Set([value]))
    }
  }

  #removeFromSet(
    map: Map<bigint, Set<number>>,
    key: bigint,
    value: number
  ): void {
    const set = map.get(key)
    if (!set) return
    set.delete(value)
    if (set.size === 0) map.delete(key)
  }

  /**
   * Resolves a 32-bit xid against an epoch-aware xid8.
   *
   * This signed modulo-2^32 calculation requires the reference and xid to be
   * within 2^31 transactions. ShapeStream enforces that lifetime bound by
   * retiring snapshots as global_last_seen_lsn passes their database_lsn.
   *
   * Mirrors `Electric.Postgres.Xid`
   * (`packages/sync-service/lib/electric/postgres/xid.ex`).
   */
  #toXid8(xid: number, referenceXid8: bigint): bigint {
    return referenceXid8 + BigInt.asIntN(32, BigInt(xid) - referenceXid8)
  }

  /**
   * Resolves each contributing xid into the epoch nearest `referenceXid8` and
   * returns the latest. Snapshot callers use `xmax` as the reference.
   */
  #resolveLatestXid8(xids: number[], referenceXid8: bigint): bigint {
    return xids.reduce((latest, xid) => {
      const xid8 = this.#toXid8(xid, referenceXid8)
      return xid8 > latest ? xid8 : latest
    }, BigInt(-1))
  }

  /**
   * Check if a change message should be filtered because its already in an active snapshot
   * Returns true if the message should be filtered out (not processed)
   */
  shouldRejectMessage(message: ChangeMessage<Row<unknown>>): boolean {
    const txids = message.headers.txids || []
    if (txids.length === 0) return false

    for (const [xmax, snapshots] of this.xmaxSnapshots.entries()) {
      const xid8 = this.#resolveLatestXid8(txids, xmax)
      if (xid8 >= xmax) {
        for (const snapshot of snapshots) {
          this.removeSnapshot(snapshot)
        }
      }
    }

    return [...this.activeSnapshots.values()].some((snapshot) => {
      if (!snapshot.keys.has(message.key)) return false
      const xid8 = this.#resolveLatestXid8(txids, snapshot.xmax)
      return isVisibleInSnapshot(xid8, snapshot)
    })
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
