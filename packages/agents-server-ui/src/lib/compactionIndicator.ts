// Staleness logic for the "Compacting…" indicator, split out so it's unit
// testable without a render harness.

/** A `running` checkpoint older than this is orphaned (its process crashed
 * before a terminal row); comfortably above the summarize timeout. */
export const STALE_RUNNING_MS = 150_000

/**
 * Whether a `running` checkpoint with `timestamp` (ISO) is orphaned at `now`
 * (ms). A missing/unparseable timestamp counts as live — we can't prove
 * staleness, and hiding an in-flight compaction is worse than over-showing one.
 */
export function isRunningCheckpointOrphaned(
  timestamp: string | undefined,
  now: number
): boolean {
  if (!timestamp) return false
  const since = Date.parse(timestamp)
  if (!Number.isFinite(since)) return false
  return now - since >= STALE_RUNNING_MS
}
