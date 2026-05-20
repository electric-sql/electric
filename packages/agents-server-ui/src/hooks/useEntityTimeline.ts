import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  buildTimelineEntries,
  compareTimelineOrders,
  createEntityIncludesQuery,
  normalizeEntityTimelineData,
} from '@electric-ax/agents-runtime/client'
import { eq } from '@tanstack/react-db'
import { connectEntityStream } from '../lib/entity-connection'
import type { TimelineEntry } from '../lib/timelineEntries'
import type {
  EntityStreamDBWithActions,
  EntityTimelineData,
  IncludesInboxMessage,
  IncludesEntity,
  Manifest,
} from '@electric-ax/agents-runtime/client'

export function useEntityTimeline(
  baseUrl: string | null,
  entityUrl: string | null
): {
  entries: Array<TimelineEntry>
  pendingInbox: EntityTimelineData[`inbox`]
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
    (q) => (db ? createEntityIncludesQuery(db)(q) : undefined),
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
  const timelineData = useMemo(
    () =>
      normalizeEntityTimelineData(
        (timelineRows as Array<EntityTimelineData>)[0] ?? {
          runs: [],
          inbox: [],
          wakes: [],
          contextInserted: [],
          contextRemoved: [],
          entities: [],
        }
      ),
    [timelineRows]
  )

  const entries = useMemo(() => {
    const baseEntries = buildTimelineEntries(
      timelineData.runs,
      timelineData.inbox,
      timelineData.wakes
    )
    const orderByKey = new Map<string, string | number>()
    for (const run of timelineData.runs) {
      orderByKey.set(`run:${run.key}`, run.order)
    }
    for (const msg of timelineData.inbox) {
      orderByKey.set(`inbox:${msg.key}`, msg.order)
    }
    for (const wake of timelineData.wakes) {
      orderByKey.set(`wake:${wake.key}`, wake.order)
    }

    const merged: Array<{ order: string | number; entry: TimelineEntry }> = [
      ...baseEntries.map((entry) => ({
        order: orderByKey.get(entry.key) ?? Number.MAX_SAFE_INTEGER,
        entry,
      })),
      ...(manifests as Array<Manifest>).map((manifest) => ({
        order: manifest._seq ?? Number.MAX_SAFE_INTEGER,
        entry: {
          key: `manifest:${manifest.key}`,
          order: manifest._seq ?? Number.MAX_SAFE_INTEGER,
          responseTimestamp: null,
          section: { kind: `manifest` as const, manifest },
        },
      })),
    ]

    return merged
      .sort((left, right) => compareTimelineOrders(left.order, right.order))
      .map(({ entry }) => entry)
  }, [manifests, timelineData.runs, timelineData.inbox, timelineData.wakes])

  const pendingInbox = useMemo(
    () =>
      (pendingInboxRows as Array<Record<string, any>>)
        .map(
          (msg): IncludesInboxMessage => ({
            key: msg.key,
            order: msg._seq ?? Number.MAX_SAFE_INTEGER,
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
    () => timelineData.runs.some((run) => run.status === `started`),
    [timelineData.runs]
  )

  return {
    entries,
    pendingInbox,
    entities: timelineData.entities,
    generationActive,
    db,
    loading,
    error,
  }
}
