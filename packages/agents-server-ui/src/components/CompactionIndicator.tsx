import { useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import styles from './CompactionIndicator.module.css'

/**
 * Live indicator shown while a synchronous context compaction is in flight.
 *
 * The runtime writes a compaction checkpoint row with `attrs.status: "running"`
 * before summarizing and supersedes it with a `complete` row when done. We read
 * the latest such row reactively; while it's `running` we show "Compacting
 * context…" so the user understands the pause (and knows their next prompt is
 * being queued). It clears the moment compaction completes.
 */

interface CheckpointRow {
  _seq?: number
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

  const running = useMemo(() => {
    // The newest compaction checkpoint wins (later writes supersede earlier
    // ones for the same id). If it's still `running`, compaction is in flight.
    let latest: CheckpointRow | null = null
    for (const row of rows as Array<CheckpointRow>) {
      if (row.attrs?.kind !== `compaction`) continue
      if (!latest || (row._seq ?? 0) > (latest._seq ?? 0)) latest = row
    }
    if (latest?.attrs?.status !== `running`) return null
    return { background: Boolean(latest.attrs?.background) }
  }, [rows])

  if (!running) return null

  // Background compaction is non-blocking, so it's shown subtly and distinctly
  // from the blocking (sync, mid-turn) "Compacting context…".
  return (
    <span
      className={[
        styles.indicator,
        running.background ? styles.background : null,
      ]
        .filter(Boolean)
        .join(` `)}
      role="status"
      aria-live="polite"
    >
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>
        {running.background
          ? `Compacting in background…`
          : `Compacting context…`}
      </span>
    </span>
  )
}
