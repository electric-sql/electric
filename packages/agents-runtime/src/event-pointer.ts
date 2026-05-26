/**
 * `EventPointer` addresses a single event on a Durable Stream.
 *
 * It is the pair the agents-server uses on the wire when forking: it
 * maps directly to the `Stream-Fork-Offset` + `Stream-Fork-Sub-Offset`
 * headers in the Durable Streams protocol.
 *
 * Semantics:
 *
 *   - `offset` is the anchor offset on the source stream. `null` means
 *     "anchor at stream start" (which translates on the wire to
 *     omitting the `Stream-Fork-Offset` header).
 *   - `subOffset` is the count of JSON messages past the anchor to
 *     include in the fork. So sub-offset `N` includes items
 *     `[0, 1, ... N-1]` of the chunk that starts at `offset`.
 *
 * A pointer addresses inclusively-through-and-stops-at-item-(subOffset-1).
 * For "fork up to and including item at batch-index `j`," set
 * `subOffset = j + 1`.
 *
 * Why this shape and not the wire's opaque offset alone:
 * the protocol ships fork-side sub-offsets but does NOT add read-side
 * sub-offsets — the wire never tells the client the sub-offset of a
 * delivered item. We compute them locally by counting positions within
 * each `JsonBatch.items` and pairing them with the batch's start
 * offset (= the previous batch's `Stream-Next-Offset`, or `null` for
 * the first batch of a fresh read).
 *
 * Limitation: local counting is correct when reads start from the
 * beginning of the stream. If a future read-side feature ever lets us
 * resume from an arbitrary mid-chunk cursor, our local counter would
 * miscount items that the server already skipped past. When the
 * protocol grows wire-provided values for that case, the local
 * counter goes away.
 */
export interface EventPointer {
  /** Anchor offset on the source stream, or `null` for stream-start. */
  offset: string | null
  /**
   * Count of JSON messages past `offset` to include — sub-offset N
   * includes items `[0 .. N-1]`. For "include item at index j," set
   * `subOffset = j + 1`.
   */
  subOffset: number
}

/**
 * A pair of widths chosen to keep the order-token format stable.
 *
 * `OFFSET_WIDTH` is the legacy pad width used by `_timeline_order`.
 * Bumping it would invalidate every persisted timeline ordering — so
 * if you ever need to widen it, you also need a migration path.
 */
const OFFSET_WIDTH = 24
const SUB_OFFSET_WIDTH = 8

/**
 * The token prefix that signals "this row was sourced from a stream
 * event" (as opposed to a pending optimistic row, a `_seq`-based
 * fallback, etc.). Kept identical to the previous single-offset
 * format so existing `like(_timeline_order, 'stream:...')` queries keep
 * matching after the upgrade.
 */
export const STREAM_TOKEN_PREFIX = `stream:`

/**
 * Format an `EventPointer` as a lexicographically-sortable token for
 * use in `_timeline_order` / `__electricRowOffsets`-derived ordering.
 *
 * The format is:
 *
 *   `stream:<zero-padded-offset>:<zero-padded-subOffset>`
 *
 * - Empty / null offsets zero-pad to all-zeros, which sorts before any
 *   non-empty offset — correct, since the first batch of a fresh read
 *   has `offset === null` and its items must sort before later batches.
 * - Higher offset → sorts later. Within the same offset, higher
 *   sub-offset → sorts later. Net: strict monotonic order matching
 *   the stream's order.
 */
export function formatPointerOrderToken(pointer: EventPointer): string {
  const paddedOffset = (pointer.offset ?? ``).padStart(OFFSET_WIDTH, `0`)
  const paddedSubOffset = pointer.subOffset
    .toString()
    .padStart(SUB_OFFSET_WIDTH, `0`)
  return `${STREAM_TOKEN_PREFIX}${paddedOffset}:${paddedSubOffset}`
}

/**
 * Compare two pointers in stream order.
 *
 *   - returns `< 0` if `left` precedes `right`
 *   - returns `> 0` if `left` follows `right`
 *   - returns `0` if they address the same event
 *
 * Compares lexicographically on the order-token form so the relation
 * agrees with `_timeline_order`'s string sort.
 */
export function comparePointers(
  left: EventPointer,
  right: EventPointer
): number {
  const leftToken = formatPointerOrderToken(left)
  const rightToken = formatPointerOrderToken(right)
  if (leftToken < rightToken) return -1
  if (leftToken > rightToken) return 1
  return 0
}

/**
 * The stream-start pointer — zero items past a null anchor. Used as
 * the initial accumulator when iterating a fresh stream from the
 * beginning before any batches have arrived.
 */
export const STREAM_START_POINTER: EventPointer = {
  offset: null,
  subOffset: 0,
}
