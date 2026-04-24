import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { connectCodingSession } from '../lib/entity-connection'
import type {
  CodingSessionEventRow,
  CodingSessionMeta,
  NormalizedEvent,
} from '../lib/types'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

export interface UseCodingSessionResult {
  db: EntityStreamDBWithActions | null
  /** Flattened NormalizedEvent timeline, in durable-stream order. */
  events: Array<NormalizedEvent>
  meta: CodingSessionMeta | undefined
  loading: boolean
  error: string | null
}

export function useCodingSession(
  baseUrl: string | null,
  entityUrl: string | null
): UseCodingSessionResult {
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

    connectCodingSession({ baseUrl, entityUrl })
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
        if (cancelled) return
        console.error(`Failed to connect coding-session stream`, err)
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      closeRef.current?.()
      closeRef.current = null
    }
  }, [baseUrl, entityUrl])

  // TanStack DB's Collection generics don't line up cleanly with useLiveQuery's
  // query builder constraints when collections come in through the entity
  // stream DB's passthrough schema. Cast to `any` here — same pattern the
  // agents-server-ui hook uses.
  const eventsCollection = db?.collections.events as any
  const metaCollection = db?.collections.sessionMeta as any

  const { data: eventRows = [] } = useLiveQuery(
    (q) =>
      eventsCollection
        ? q.from({ e: eventsCollection }).orderBy(({ e }: any) => e.$key, `asc`)
        : undefined,
    [eventsCollection]
  )
  const { data: metaRows = [] } = useLiveQuery(
    (q) => (metaCollection ? q.from({ m: metaCollection }) : undefined),
    [metaCollection]
  )

  const events = useMemo(() => {
    const rows = eventRows as unknown as Array<CodingSessionEventRow>
    return rows.map((r) => r.payload as NormalizedEvent)
  }, [eventRows])
  const meta = useMemo(
    () => (metaRows as unknown as Array<CodingSessionMeta>)[0],
    [metaRows]
  )

  return { db, events, meta, loading, error }
}
