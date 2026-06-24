import { coalesce, eq } from '@durable-streams/state/db'
import { TIMELINE_ORDER_FALLBACK } from '@electric-ax/agents-runtime/client'
import type {
  EntityStreamDBWithActions,
  EntityTimelineCustomSource,
} from '@electric-ax/agents-runtime/client'

/**
 * Compaction checkpoints are persisted as `context_inserted` rows tagged
 * `name: "compaction_summary"`. The runtime timeline query doesn't surface
 * them; `useEntityTimeline` merges them in via this custom source so a
 * "Context compacted" marker can render in the message history at the point
 * compaction happened. Must match the runtime's COMPACTION_CHECKPOINT_NAME.
 */
const COMPACTION_CHECKPOINT_NAME = `compaction_summary`

export type EntityTimelineCompactionRow = {
  key: string
  order: string
  attrs?: { kind?: string; status?: string }
  content: string
  timestamp: string
}

export type CompactionTimelineRow = {
  $key: string
  compaction: EntityTimelineCompactionRow
  comment?: undefined
  inbox?: undefined
  run?: undefined
  wake?: undefined
  signal?: undefined
  error?: undefined
  manifest?: undefined
}

export function createCompactionTimelineSource(
  db: EntityStreamDBWithActions
): EntityTimelineCustomSource {
  const contextInserted = (db.collections as Record<string, any>)
    .contextInserted
  return (q) =>
    q
      .from({ compaction: contextInserted })
      .where(({ compaction }: any) =>
        eq(compaction.name, COMPACTION_CHECKPOINT_NAME)
      )
      .select(({ compaction }: any) => ({
        order: coalesce(compaction._timeline_order, TIMELINE_ORDER_FALLBACK),
        key: compaction.key,
        attrs: compaction.attrs,
        content: coalesce(compaction.content, ``),
        timestamp: coalesce(compaction.timestamp, ``),
      }))
}

/** A completed compaction is the persistent marker; running/failed are not. */
export function isCompletedCompactionRow(row: {
  compaction?: EntityTimelineCompactionRow
}): boolean {
  return row.compaction?.attrs?.status === `complete`
}
