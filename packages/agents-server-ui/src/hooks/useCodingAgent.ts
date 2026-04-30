import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
} from '@electric-ax/coding-agents'
import { connectEntityStream } from '../lib/entity-connection'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

export type CodingAgentSliceAStatus =
  | `cold`
  | `starting`
  | `idle`
  | `running`
  | `stopping`
  | `error`
  | `destroyed`

export interface SessionMetaRow {
  key: string
  status: CodingAgentSliceAStatus
  kind: `claude`
  pinned: boolean
  workspaceIdentity: string
  idleTimeoutMs: number
  keepWarm: boolean
  instanceId?: string
  lastError?: string
  nativeSessionId?: string
}

export interface RunRow {
  key: string
  startedAt: number
  endedAt?: number
  status: `running` | `completed` | `failed`
  finishReason?: string
  promptInboxKey: string
  responseText?: string
}

export interface EventRow {
  key: string
  runId: string
  seq: number
  ts: number
  type: string
  payload: Record<string, unknown>
}

export interface LifecycleRow {
  key: string
  ts: number
  event: string
  detail?: string
}

const CODING_AGENT_STATE = {
  sessionMeta: { type: CODING_AGENT_SESSION_META_COLLECTION_TYPE, primaryKey: `key` },
  runs: { type: CODING_AGENT_RUNS_COLLECTION_TYPE, primaryKey: `key` },
  events: { type: CODING_AGENT_EVENTS_COLLECTION_TYPE, primaryKey: `key` },
  lifecycle: { type: CODING_AGENT_LIFECYCLE_COLLECTION_TYPE, primaryKey: `key` },
} as const

export interface UseCodingAgentResult {
  db: EntityStreamDBWithActions | null
  meta: SessionMetaRow | undefined
  runs: Array<RunRow>
  events: Array<EventRow>
  lifecycle: Array<LifecycleRow>
  loading: boolean
  error: string | null
}

export function useCodingAgent(
  baseUrl: string | null,
  entityUrl: string | null
): UseCodingAgentResult {
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

    connectEntityStream({ baseUrl, entityUrl, customState: CODING_AGENT_STATE })
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
          console.error(`Failed to connect coding-agent stream`, { baseUrl, entityUrl, error: err })
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

  const metaCollection = db?.collections.sessionMeta
  const runsCollection = db?.collections.runs
  const eventsCollection = db?.collections.events
  const lifecycleCollection = db?.collections.lifecycle

  const { data: metaRows = [] } = useLiveQuery(
    (q) => (metaCollection ? q.from({ m: metaCollection }) : undefined),
    [metaCollection]
  )
  const { data: runRows = [] } = useLiveQuery(
    (q) => runsCollection ? q.from({ r: runsCollection }).orderBy(({ r }) => r.$key, `asc`) : undefined,
    [runsCollection]
  )
  const { data: eventRows = [] } = useLiveQuery(
    (q) => eventsCollection ? q.from({ e: eventsCollection }).orderBy(({ e }) => e.$key, `asc`) : undefined,
    [eventsCollection]
  )
  const { data: lifecycleRows = [] } = useLiveQuery(
    (q) => lifecycleCollection ? q.from({ l: lifecycleCollection }).orderBy(({ l }) => l.$key, `asc`) : undefined,
    [lifecycleCollection]
  )

  const meta = useMemo(() => (metaRows as unknown as Array<SessionMetaRow>)[0], [metaRows])
  const runs = useMemo(() => runRows as unknown as Array<RunRow>, [runRows])
  const events = useMemo(() => eventRows as unknown as Array<EventRow>, [eventRows])
  const lifecycle = useMemo(() => lifecycleRows as unknown as Array<LifecycleRow>, [lifecycleRows])

  return { db, meta, runs, events, lifecycle, loading, error }
}
