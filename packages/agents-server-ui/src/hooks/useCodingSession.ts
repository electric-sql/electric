import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { connectEntityStream } from '../lib/entity-connection'
import type {
  CodingSessionEventRow,
  CodingSessionMetaRow,
  CodingSessionStatus,
  EntityStreamDBWithActions,
} from '@electric-ax/agents-runtime'

// Re-export the canonical types so existing imports from this module
// (e.g. CodingSessionTimeline) keep resolving without a churn.
export type { CodingSessionEventRow, CodingSessionMetaRow, CodingSessionStatus }

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

export interface UseCodingSessionResult {
  db: EntityStreamDBWithActions | null
  /**
   * Normalized session events from the CLI's JSONL transcript, plus
   * synthetic user_message rows for any prompt that's been posted to
   * the inbox but not yet reflected in the transcript. Synthetic rows
   * carry `payload._pending: true` so the timeline can render them
   * with a subtle "queued" affordance.
   */
  events: Array<CodingSessionEventRow>
  meta: CodingSessionMetaRow | undefined
  loading: boolean
  error: string | null
}

interface InboxRowShape {
  key: string
  from?: string
  payload?: { text?: unknown }
  timestamp?: string
  message_type?: string
}

interface CursorStateRowShape {
  key: string
  cursor?: string
  lastProcessedInboxKey?: string
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
  const cursorCollection = db?.collections.cursorState
  const inboxCollection = db?.collections.inbox

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
  const { data: cursorRows = [] } = useLiveQuery(
    (q) => (cursorCollection ? q.from({ c: cursorCollection }) : undefined),
    [cursorCollection]
  )
  const { data: inboxRows = [] } = useLiveQuery(
    (q) =>
      inboxCollection
        ? q.from({ i: inboxCollection }).orderBy(({ i }) => i.$key, `asc`)
        : undefined,
    [inboxCollection]
  )

  const meta = useMemo(
    () => (metaRows as unknown as Array<CodingSessionMetaRow>)[0],
    [metaRows]
  )

  const events = useMemo(() => {
    const real = eventRows as unknown as Array<CodingSessionEventRow>
    const cursor = (cursorRows as unknown as Array<CursorStateRowShape>)[0]
    const lastProcessed = cursor?.lastProcessedInboxKey ?? ``
    // Once a prompt's text shows up as a real user_message (mirrored
    // from the CLI's JSONL), there's nothing for the pending bubble
    // to add — drop it immediately to avoid a duplicate below the
    // assistant's reply. Track remaining capacity per text so two
    // identical prompts in a row each get matched at most once.
    const realUserTextRemaining = new Map<string, number>()
    for (const r of real) {
      if (r.type !== `user_message`) continue
      const t = (r.payload as { text?: unknown }).text
      if (typeof t !== `string` || t.length === 0) continue
      realUserTextRemaining.set(t, (realUserTextRemaining.get(t) ?? 0) + 1)
    }
    // Show inbox prompts that haven't been processed yet AND whose
    // text hasn't already shown up as a real user_message in events.
    // Inbox keys are durable-stream offsets that sort lexicographically.
    const pending: Array<CodingSessionEventRow> = []
    for (const row of inboxRows as unknown as Array<InboxRowShape>) {
      if (row.key <= lastProcessed) continue
      const text = row.payload?.text
      if (typeof text !== `string` || text.length === 0) continue
      const remaining = realUserTextRemaining.get(text) ?? 0
      if (remaining > 0) {
        realUserTextRemaining.set(text, remaining - 1)
        continue
      }
      const ts = row.timestamp ? Date.parse(row.timestamp) : Date.now()
      pending.push({
        key: `pending:${row.key}`,
        ts: Number.isFinite(ts) ? ts : Date.now(),
        type: `user_message`,
        payload: {
          text,
          user: row.from ? { name: row.from } : undefined,
          _pending: true,
        },
      })
    }
    if (pending.length === 0) return real
    return [...real, ...pending]
  }, [eventRows, inboxRows, cursorRows])

  return { db, events, meta, loading, error }
}
