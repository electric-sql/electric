import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  compareTimelineOrders,
  createEntityTimelineQuery,
  normalizeTimelineEntities,
  TIMELINE_ORDER_FALLBACK,
} from '@electric-ax/agents-runtime/client'
import { coalesce, eq } from '@durable-streams/state/db'
import { connectEntityStream } from '../lib/entity-connection'
import { createCommentsTimelineSource } from '../lib/comments'
import {
  createCompactionTimelineSource,
  isCompletedCompactionRow,
} from '../lib/compaction'
import type { TimelineRow } from '../lib/comments'
import type {
  EntityStreamDBWithActions,
  IncludesInboxMessage,
  IncludesEntity,
  Manifest,
} from '@electric-ax/agents-runtime/client'

type TimelineEntityManifest =
  | (Manifest & { kind: `child`; id: string; entity_url: string })
  | (Manifest & {
      kind: `source`
      sourceType: `entity`
      sourceRef: string
      config: Record<string, unknown>
    })

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === `object`
}

function isTimelineEntityManifest(
  manifest: Manifest
): manifest is TimelineEntityManifest {
  if (manifest.kind === `child`) {
    return (
      typeof manifest.id === `string` && typeof manifest.entity_url === `string`
    )
  }
  return (
    manifest.kind === `source` &&
    manifest.sourceType === `entity` &&
    typeof manifest.sourceRef === `string` &&
    isRecord(manifest.config)
  )
}

export function useEntityTimeline(
  baseUrl: string | null,
  entityUrl: string | null,
  opts?: {
    /** Merge the `comments` collection into the timeline. Defaults to true. */
    comments?: boolean
  }
): {
  timelineRows: Array<TimelineRow>
  pendingInbox: Array<IncludesInboxMessage>
  entities: Array<IncludesEntity>
  generationActive: boolean
  db: EntityStreamDBWithActions | null
  loading: boolean
  error: string | null
  /**
   * True when the entity's type declares the comments collection — the
   * stream connection only registers `db.collections.comments` for types
   * whose registration advertises the comments contract.
   */
  commentsEnabled: boolean
} {
  const [db, setDb] = useState<EntityStreamDBWithActions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setDb(null)
    setError(null)

    if (!baseUrl || !entityUrl) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    connectEntityStream({ baseUrl, entityUrl })
      .then((result) => {
        if (cancelled) {
          result.close()
          return
        }
        closeRef.current = result.close
        setDb(result.db)
        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(`Failed to connect entity stream`, {
            baseUrl,
            entityUrl,
            error: err,
          })
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      closeRef.current?.()
      closeRef.current = null
    }
  }, [baseUrl, entityUrl])

  const commentsEnabled = Boolean(
    db && (db.collections as Record<string, unknown>).comments
  )
  const includeComments = commentsEnabled && (opts?.comments ?? true)
  const { data: timelineRows = [] } = useLiveQuery(
    (q) => {
      if (!db) return undefined
      return createEntityTimelineQuery(db, {
        customSources: {
          compaction: createCompactionTimelineSource(db),
          ...(includeComments && {
            comment: createCommentsTimelineSource(db),
          }),
        },
      })(q)
    },
    [db, includeComments]
  )
  const { data: manifests = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ manifest: db.collections.manifests as any })
            .orderBy(({ manifest }: any) => manifest._seq, `asc`)
        : undefined,
    [db]
  )
  const { data: pendingInboxRows = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ inbox: db.collections.inbox as any })
            .where(({ inbox }: any) => eq(inbox.status, `pending`))
            .orderBy(
              ({ inbox }: any) =>
                coalesce(inbox._timeline_order, TIMELINE_ORDER_FALLBACK),
              `asc`
            )
            .orderBy(({ inbox }: any) =>
              coalesce(inbox._seq, Number.MAX_SAFE_INTEGER)
            )
        : undefined,
    [db]
  )
  // Only a *completed* compaction checkpoint renders as a timeline marker;
  // `running`/`failed` checkpoints are surfaced by the live composer indicator
  // instead, not as message-history entries.
  const typedTimelineRows = useMemo(
    () =>
      (timelineRows as Array<TimelineRow>).filter(
        (row) => !row.compaction || isCompletedCompactionRow(row)
      ),
    [timelineRows]
  )

  const pendingInbox = useMemo(
    () =>
      (pendingInboxRows as Array<Record<string, any>>)
        .map(
          (msg): IncludesInboxMessage => ({
            key: msg.key,
            order: msg._timeline_order ?? msg._seq ?? Number.MAX_SAFE_INTEGER,
            from: msg.from,
            from_principal: msg.from_principal,
            from_agent: msg.from_agent,
            payload: msg.payload,
            timestamp: msg.timestamp,
            mode: msg.mode ?? `queued`,
            status: msg.status ?? `pending`,
            position: msg.position,
            processed_at: msg.processed_at,
            cancelled_at: msg.cancelled_at,
          })
        )
        .filter((msg) => msg.status === `pending`)
        .sort((left, right) => {
          if (
            left.position &&
            right.position &&
            left.position !== right.position
          ) {
            return left.position < right.position ? -1 : 1
          }
          if (left.position && !right.position) return -1
          if (!left.position && right.position) return 1
          if (
            left.timestamp &&
            right.timestamp &&
            left.timestamp !== right.timestamp
          ) {
            return left.timestamp < right.timestamp ? -1 : 1
          }
          return compareTimelineOrders(left.order, right.order)
        }),
    [pendingInboxRows]
  )
  const generationActive = useMemo(
    () => typedTimelineRows.some((row) => row.run?.status === `started`),
    [typedTimelineRows]
  )
  const entities = useMemo(
    () =>
      normalizeTimelineEntities(
        (manifests as Array<Manifest>).filter(isTimelineEntityManifest).map(
          (manifest): IncludesEntity => ({
            key:
              manifest.kind === `child`
                ? manifest.entity_url
                : String(manifest.config.entityUrl ?? manifest.sourceRef),
            kind: manifest.kind,
            id: manifest.kind === `child` ? manifest.id : manifest.sourceRef,
            url:
              manifest.kind === `child`
                ? manifest.entity_url
                : String(manifest.config.entityUrl ?? manifest.sourceRef),
            type: manifest.kind === `child` ? manifest.entity_type : undefined,
            observed: manifest.kind === `source` || Boolean(manifest.observed),
            wake: manifest.wake,
          })
        )
      ),
    [manifests]
  )

  return {
    timelineRows: typedTimelineRows,
    pendingInbox,
    entities,
    generationActive,
    db,
    loading,
    error,
    commentsEnabled,
  }
}
