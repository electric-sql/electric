import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import {
  STALE_RUNNING_MS,
  isRunningCheckpointOrphaned,
} from '../lib/compactionIndicator'
import styles from './CompactionIndicator.module.css'

/**
 * Live indicator shown while a context compaction is in flight.
 *
 * The runtime writes a compaction checkpoint row with `attrs.status: "running"`
 * before summarizing and supersedes it with a `complete` (or `failed`) row when
 * done. We read the latest such row reactively; while it's `running` we show
 * "Compacting context…" so the user understands the pause. It clears the moment
 * compaction completes.
 *
 * A summarize is bounded by a hard timeout (~120s) after which a terminal row is
 * always written, so a `running` row that lingers well past that is orphaned —
 * its process crashed before writing the terminal row. We stop showing the
 * spinner for such a row (and self-clear via a timer so it disappears even with
 * no further events). See `lib/compactionIndicator` for the staleness rule.
 */

interface CheckpointRow {
  _seq?: number
  timestamp?: string
  attrs?: { kind?: string; status?: string; background?: boolean }
}

interface CompactionIndicatorProps {
  db: EntityStreamDBWithActions | null
}

export function CompactionIndicator({
  db,
}: CompactionIndicatorProps): React.ReactElement | null {
  const { data: rows = [] } = useLiveQuery(
    (q) =>
      db && db.collections.contextInserted
        ? q.from({ entry: db.collections.contextInserted as any })
        : undefined,
    [db]
  )

  const latest = useMemo(() => {
    // The newest compaction checkpoint wins (later writes supersede earlier ones
    // for the same id). Only a `running` one drives the spinner.
    let latest: CheckpointRow | null = null
    for (const row of rows as Array<CheckpointRow>) {
      if (row.attrs?.kind !== `compaction`) continue
      if (!latest || (row._seq ?? 0) > (latest._seq ?? 0)) latest = row
    }
    return latest?.attrs?.status === `running` ? latest : null
  }, [rows])

  const runningSince = latest?.timestamp
    ? Date.parse(latest.timestamp)
    : Number.NaN

  // Re-render once the running checkpoint crosses the staleness deadline, so an
  // orphaned spinner clears itself even if no further events arrive.
  const [, bump] = useState(0)
  useEffect(() => {
    if (!latest || !Number.isFinite(runningSince)) return
    const remaining = STALE_RUNNING_MS - (Date.now() - runningSince)
    if (remaining <= 0) return
    const id = setTimeout(() => bump((n) => n + 1), remaining)
    return () => clearTimeout(id)
  }, [latest, runningSince])

  if (!latest) return null
  if (isRunningCheckpointOrphaned(latest.timestamp, Date.now())) return null

  // Background compaction is non-blocking, so it's shown subtly and distinctly
  // from the blocking (sync, mid-turn) "Compacting context…".
  const background = Boolean(latest.attrs?.background)
  return (
    <span
      className={[styles.indicator, background ? styles.background : null]
        .filter(Boolean)
        .join(` `)}
      role="status"
      aria-live="polite"
    >
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>
        {background ? `Compacting in background…` : `Compacting context…`}
      </span>
    </span>
  )
}
