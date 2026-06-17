/**
 * Staleness logic for the "Compacting…" indicator, extracted so it can be unit
 * tested without a DOM/render harness (this package has no React-render test
 * setup).
 */

/**
 * Beyond this age a still-`running` compaction checkpoint is treated as orphaned
 * (its process crashed before writing a terminal `complete`/`failed` row). A
 * summarize is bounded by a ~120s hard timeout after which a terminal row is
 * always written, so 150s comfortably clears only genuinely-crashed runs.
 */
export const STALE_RUNNING_MS = 150_000

/**
 * Whether a `running` checkpoint with the given `timestamp` (ISO string) should
 * be treated as orphaned at `now` (ms). A missing or unparseable timestamp is
 * treated as NOT orphaned — we can't prove staleness, and hiding a genuinely
 * in-flight compaction is worse than briefly over-showing one. (insertContext
 * always stamps a timestamp, so this only guards against a schema regression.)
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
