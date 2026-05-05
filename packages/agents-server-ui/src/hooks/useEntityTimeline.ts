import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  buildTimelineEntries,
  createEntityIncludesQuery,
  normalizeEntityTimelineData,
} from '@electric-ax/agents-runtime'
import {
  closeEntityStream,
  connectEntityStream,
} from '../lib/entity-connection'
import type {
  EntityStreamDBWithActions,
  EntityTimelineData,
  EntityTimelineEntry,
  IncludesEntity,
} from '@electric-ax/agents-runtime'

export function useEntityTimeline(
  baseUrl: string | null,
  entityUrl: string | null,
  /**
   * Pre-loaded db from the route loader. When provided, the hook skips
   * its own connectEntityStream call and uses this instance directly.
   * The loader is responsible for closing it via closeEntityStream.
   */
  preloadedDb?: EntityStreamDBWithActions | null
): {
  entries: Array<EntityTimelineEntry>
  entities: Array<IncludesEntity>
  db: EntityStreamDBWithActions | null
  loading: boolean
  error: string | null
} {
  const [db, setDb] = useState<EntityStreamDBWithActions | null>(
    preloadedDb ?? null
  )
  const [loading, setLoading] = useState(!preloadedDb)
  const [error, setError] = useState<string | null>(null)

  // Track whether we self-connected (vs. using a preloaded db) so we
  // know whether to call closeEntityStream on cleanup.
  const selfConnectedRef = useRef(false)
  const connectedKeyRef = useRef<{ baseUrl: string; entityUrl: string } | null>(
    null
  )

  useEffect(() => {
    // If a preloaded db was passed in, use it directly — no self-connection.
    if (preloadedDb != null) {
      setDb(preloadedDb)
      setLoading(false)
      setError(null)
      selfConnectedRef.current = false
      connectedKeyRef.current = null
      return
    }

    setDb(null)
    setError(null)

    if (!baseUrl || !entityUrl) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    selfConnectedRef.current = true
    connectedKeyRef.current = { baseUrl, entityUrl }

    connectEntityStream({ baseUrl, entityUrl })
      .then((result) => {
        if (cancelled) return
        setDb(result.db)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(`Failed to connect entity stream`, {
          baseUrl,
          entityUrl,
          error: err,
        })
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      // Only close if we opened the connection ourselves.
      if (selfConnectedRef.current && connectedKeyRef.current) {
        closeEntityStream(connectedKeyRef.current)
        selfConnectedRef.current = false
        connectedKeyRef.current = null
      }
    }
  }, [baseUrl, entityUrl, preloadedDb])

  const { data: timelineRows = [] } = useLiveQuery(
    (q) => (db ? createEntityIncludesQuery(db)(q) : undefined),
    [db]
  )
  const timelineData = useMemo(
    () =>
      normalizeEntityTimelineData(
        (timelineRows as Array<EntityTimelineData>)[0] ?? {
          runs: [],
          inbox: [],
          wakes: [],
          entities: [],
        }
      ),
    [timelineRows]
  )

  const entries = useMemo(
    () => buildTimelineEntries(timelineData.runs, timelineData.inbox),
    [timelineData.runs, timelineData.inbox]
  )

  return { entries, entities: timelineData.entities, db, loading, error }
}
