import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  compareTimelineOrders,
  createEntityTimelineQuery,
  normalizeTimelineEntities,
} from '@electric-ax/agents-runtime/client'
import { eq } from '@tanstack/db'
import { connectEntityStream } from '../lib/entity-connection'
import type {
  EntityStreamDBWithActions,
  EntityTimelineQueryRow,
  IncludesInboxMessage,
  IncludesEntity,
  Manifest,
} from '@electric-ax/agents-runtime/client'

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

  const { data: timelineRows = [] } = useLiveQuery(
    (q) => {
      if (!db) return undefined
      return createEntityTimelineQuery(db)(q)
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
            .orderBy(({ inbox }) => inbox._seq, `asc`)
        : undefined,
    [db]
  )
  const typedTimelineRows = timelineRows as Array<EntityTimelineQueryRow>

  const pendingInbox = useMemo(
    () =>
      (pendingInboxRows as Array<Record<string, any>>)
        .map(
          (msg): IncludesInboxMessage => ({
            key: msg.key,
            order: msg._timeline_order ?? msg._seq ?? Number.MAX_SAFE_INTEGER,
            from: msg.from,
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
        (manifests as Array<Manifest>)
          .filter(
            (manifest) =>
              manifest.kind === `child` || manifest.kind === `source`
          )
          .map(
            (manifest): IncludesEntity => ({
              key:
                manifest.kind === `child`
                  ? manifest.entity_url
                  : manifest.sourceRef,
              kind: manifest.kind,
              id: manifest.kind === `child` ? manifest.id : manifest.sourceRef,
              url:
                manifest.kind === `child`
                  ? manifest.entity_url
                  : manifest.sourceRef,
              type:
                manifest.kind === `child` ? manifest.entity_type : undefined,
              observed:
                manifest.kind === `source` || Boolean(manifest.observed),
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
  }
}
