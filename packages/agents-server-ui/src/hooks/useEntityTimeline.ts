import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  compareTimelineOrders,
  createEntityTimelineQuery,
  normalizeTimelineEntities,
  passthrough,
} from '@electric-ax/agents-runtime/client'
import { coalesce, eq } from '@durable-streams/state/db'
import { connectEntityStream } from '../lib/entity-connection'
import type {
  EntityStreamDBWithActions,
  EntityTimelineQueryRow as RuntimeEntityTimelineQueryRow,
  IncludesInboxMessage,
  IncludesEntity,
  Manifest,
} from '@electric-ax/agents-runtime/client'
import type {
  CommentRow,
  EntityTimelineCommentRow,
  EntityTimelineQueryRow,
} from '../lib/comments'

const TIMELINE_ORDER_FALLBACK = `~`

/**
 * Comments are a custom collection declared by the entity type (see
 * horton's and worker's `customCollectionSchemas: { comment: ... }`).
 * The UI registers the matching TanStack DB collection here so
 * `db.collections.comments` resolves and the runtime can splice it
 * into the timeline projection via `createEntityTimelineQuery`'s
 * `customSource` option.
 */
const COMMENT_CUSTOM_STATE = {
  comments: {
    schema: passthrough<CommentRow>(),
    type: `comment`,
    primaryKey: `key`,
  },
} as const

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

/**
 * Re-shape the runtime's generic `custom` variant into a UI-friendly
 * `comment` variant. Runs synchronously off the same live-query result so
 * comments stay perfectly in order with the rest of the timeline.
 */
function projectRow(
  row: RuntimeEntityTimelineQueryRow
): EntityTimelineQueryRow {
  if (row.custom && row.custom.collection === `comment`) {
    const value = row.custom.value as CommentRow
    return {
      $key: row.$key,
      comment: {
        ...value,
        key: row.custom.key,
        order: row.custom.order,
      } as EntityTimelineCommentRow,
    } as EntityTimelineQueryRow
  }
  return row as EntityTimelineQueryRow
}

export function useEntityTimeline(
  baseUrl: string | null,
  entityUrl: string | null
): {
  timelineRows: Array<EntityTimelineQueryRow>
  pendingInbox: Array<IncludesInboxMessage>
  entities: Array<IncludesEntity>
  generationActive: boolean
  db: EntityStreamDBWithActions | null
  loading: boolean
  error: string | null
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

    connectEntityStream({
      baseUrl,
      entityUrl,
      customState: COMMENT_CUSTOM_STATE,
    })
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

  const { data: rawTimelineRows = [] } = useLiveQuery(
    (q) => {
      if (!db) return undefined
      const customSource = q
        .from({ comment: (db.collections as any).comments })
        .select(({ comment }: any) => ({
          collection: `comment` as const,
          order: coalesce(comment._timeline_order, TIMELINE_ORDER_FALLBACK),
          key: comment.key,
          value: comment,
        }))
      return createEntityTimelineQuery(db, { customSource })(q)
    },
    [db]
  )
  const { data: manifests = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ manifest: db.collections.manifests })
            .orderBy(({ manifest }) => manifest._seq, `asc`)
        : undefined,
    [db]
  )
  const { data: pendingInboxRows = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ inbox: db.collections.inbox })
            .where(({ inbox }) => eq(inbox.status, `pending`))
            .orderBy(
              ({ inbox }) =>
                coalesce(inbox._timeline_order, TIMELINE_ORDER_FALLBACK),
              `asc`
            )
            .orderBy(({ inbox }) =>
              coalesce(inbox._seq, Number.MAX_SAFE_INTEGER)
            )
        : undefined,
    [db]
  )

  const timelineRows = useMemo<Array<EntityTimelineQueryRow>>(
    () =>
      (rawTimelineRows as Array<RuntimeEntityTimelineQueryRow>).map(projectRow),
    [rawTimelineRows]
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
    () => timelineRows.some((row) => row.run?.status === `started`),
    [timelineRows]
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
    timelineRows,
    pendingInbox,
    entities,
    generationActive,
    db,
    loading,
    error,
  }
}
