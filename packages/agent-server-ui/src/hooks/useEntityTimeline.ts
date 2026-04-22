import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  buildTimelineEntries,
  createEntityIncludesQuery,
  normalizeEntityTimelineData,
} from '@electric-ax/agent-runtime'
import { connectEntityStream } from '../lib/entity-connection'
import type {
  EntityStreamDBWithActions,
  EntityTimelineData,
  EntityTimelineEntry,
  IncludesEntity,
} from '@electric-ax/agent-runtime'

export function useEntityTimeline(
  baseUrl: string | null,
  entityUrl: string | null
): {
  entries: Array<EntityTimelineEntry>
  entities: Array<IncludesEntity>
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
