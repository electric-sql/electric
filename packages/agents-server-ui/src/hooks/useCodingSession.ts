import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { connectEntityStream } from '../lib/entity-connection'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

/**
 * Mirrors the state-collection shape declared by the `coding-session`
 * entity in `@electric-ax/agents/src/agents/coding-session.ts`. Kept in
 * sync by hand; collection names + event types are part of the entity
 * type's public contract.
 */
const CODING_SESSION_STATE = {
  sessionMeta: { type: `coding_session_meta`, primaryKey: `key` },
  cursorState: { type: `coding_session_cursor`, primaryKey: `key` },
  events: { type: `coding_session_event`, primaryKey: `key` },
} as const

export type CodingSessionEventType =
  | `session_init`
  | `user_message`
  | `assistant_message`
  | `thinking`
  | `tool_call`
  | `tool_result`
  | `permission_request`
  | `permission_response`
  | `turn_complete`
  | `turn_aborted`
  | `compaction`
  | `error`
  | `session_end`

export interface CodingSessionEventRow {
  key: string
  ts: number
  type: string
  callId?: string
  payload: Record<string, unknown>
}

export type CodingSessionStatus = `initializing` | `idle` | `running` | `error`

export interface CodingSessionMetaRow {
  key: string
  electricSessionId: string
  nativeSessionId?: string
  agent: `claude` | `codex`
  cwd: string
  status: CodingSessionStatus
  error?: string
  currentPromptInboxKey?: string
}

export interface UseCodingSessionResult {
  db: EntityStreamDBWithActions | null
  events: Array<CodingSessionEventRow>
  meta: CodingSessionMetaRow | undefined
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

    connectEntityStream({
      baseUrl,
      entityUrl,
      customState: CODING_SESSION_STATE,
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
          console.error(`Failed to connect coding-session stream`, {
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

  const eventsCollection = db?.collections.events
  const metaCollection = db?.collections.sessionMeta

  const { data: eventRows = [] } = useLiveQuery(
    (q) =>
      eventsCollection
        ? q.from({ e: eventsCollection }).orderBy(({ e }) => e.$key, `asc`)
        : undefined,
    [eventsCollection]
  )
  const { data: metaRows = [] } = useLiveQuery(
    (q) => (metaCollection ? q.from({ m: metaCollection }) : undefined),
    [metaCollection]
  )

  const events = useMemo(
    () => eventRows as unknown as Array<CodingSessionEventRow>,
    [eventRows]
  )
  const meta = useMemo(
    () => (metaRows as unknown as Array<CodingSessionMetaRow>)[0],
    [metaRows]
  )

  return { db, events, meta, loading, error }
}
