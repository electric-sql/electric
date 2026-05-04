import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  CODER_RESOURCE_TAG,
  CODING_SESSION_RESOURCE_INFO_TYPE,
  CODING_SESSION_RESOURCE_TRANSCRIPT_TYPE,
  codingSessionResourceId,
} from '@electric-ax/agents-runtime'
import {
  connectEntityStream,
  connectSharedStateStream,
} from '../lib/entity-connection'
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
 * The coder entity is now a thin wrapper over a coding-session
 * **resource** (a shared-state DB). The entity owns only the run
 * lifecycle bookkeeping — `runStatus` (idle/running/error) and
 * `inboxCursor` (last processed prompt) — while the durable history
 * (`events`) and the static session facts (`sessionInfo`) live on
 * the resource. The UI follows a `coderResource` tag the entity
 * publishes on first wake to find the resource id, then connects to
 * both streams in parallel and recombines the data into the legacy
 * `CodingSessionMetaRow` shape that timeline/components consume.
 */

const RUN_STATUS_COLLECTION_TYPE = `coder_run_status`
const INBOX_CURSOR_COLLECTION_TYPE = `coder_inbox_cursor`

const ENTITY_CUSTOM_STATE = {
  runStatus: {
    type: RUN_STATUS_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  inboxCursor: {
    type: INBOX_CURSOR_COLLECTION_TYPE,
    primaryKey: `key`,
  },
} as const

const RESOURCE_CUSTOM_STATE = {
  sessionInfo: {
    type: CODING_SESSION_RESOURCE_INFO_TYPE,
    primaryKey: `key`,
  },
  transcript: {
    type: CODING_SESSION_RESOURCE_TRANSCRIPT_TYPE,
    primaryKey: `key`,
  },
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
  /** The entity stream (runStatus, inboxCursor, inbox). */
  db: EntityStreamDBWithActions | null
  /**
   * Normalized session events from the resource, plus synthetic
   * user_message rows for any prompt that's been posted to the inbox
   * but not yet reflected in the transcript. Synthetic rows carry
   * `payload._pending: true` so the timeline can render them with a
   * subtle "queued" affordance.
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

interface InboxCursorRowShape {
  key: string
  lastProcessedInboxKey?: string
}

interface RunStatusRowShape {
  key: string
  status: CodingSessionStatus
  error?: string
  currentPromptInboxKey?: string
}

interface SessionInfoRowShape {
  key: string
  agent: `claude` | `codex`
  cwd: string
  electricSessionId: string
  nativeSessionId?: string
  createdAt: number
}

export function useCodingSession(
  baseUrl: string | null,
  entityUrl: string | null
): UseCodingSessionResult {
  const [entityDb, setEntityDb] = useState<EntityStreamDBWithActions | null>(
    null
  )
  const [resourceDb, setResourceDb] =
    useState<EntityStreamDBWithActions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closersRef = useRef<Array<() => void>>([])

  useEffect(() => {
    setEntityDb(null)
    setResourceDb(null)
    setError(null)

    if (!baseUrl || !entityUrl) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async (): Promise<void> => {
      try {
        const entityResult = await connectEntityStream({
          baseUrl,
          entityUrl,
          customState: ENTITY_CUSTOM_STATE,
        })
        if (cancelled) {
          entityResult.close()
          return
        }
        closersRef.current.push(entityResult.close)
        setEntityDb(entityResult.db)

        // The entity tags itself with `coderResource` on first wake.
        // For a freshly spawned coder the tag may not be set yet; fall
        // back to the deterministic id in that case so the resource
        // stream still loads.
        const fallbackId = codingSessionResourceId(
          entityUrl.split(`/`).pop() ?? entityUrl
        )
        const resourceId =
          entityResult.entity.tags[CODER_RESOURCE_TAG] ?? fallbackId

        const resourceResult = await connectSharedStateStream({
          baseUrl,
          resourceId,
          customState: RESOURCE_CUSTOM_STATE,
        })
        if (cancelled) {
          resourceResult.close()
          return
        }
        closersRef.current.push(resourceResult.close)
        setResourceDb(resourceResult.db)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error(`Failed to connect coding-session streams`, {
          baseUrl,
          entityUrl,
          error: err,
        })
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      for (const close of closersRef.current) close()
      closersRef.current = []
    }
  }, [baseUrl, entityUrl])

  const transcriptCollection = resourceDb?.collections.transcript
  const sessionInfoCollection = resourceDb?.collections.sessionInfo
  const runStatusCollection = entityDb?.collections.runStatus
  const inboxCursorCollection = entityDb?.collections.inboxCursor
  const inboxCollection = entityDb?.collections.inbox

  const { data: eventRows = [] } = useLiveQuery(
    (q) =>
      transcriptCollection
        ? q.from({ e: transcriptCollection }).orderBy(({ e }) => e.$key, `asc`)
        : undefined,
    [transcriptCollection]
  )
  const { data: sessionInfoRows = [] } = useLiveQuery(
    (q) =>
      sessionInfoCollection ? q.from({ s: sessionInfoCollection }) : undefined,
    [sessionInfoCollection]
  )
  const { data: runStatusRows = [] } = useLiveQuery(
    (q) =>
      runStatusCollection ? q.from({ r: runStatusCollection }) : undefined,
    [runStatusCollection]
  )
  const { data: inboxCursorRows = [] } = useLiveQuery(
    (q) =>
      inboxCursorCollection ? q.from({ c: inboxCursorCollection }) : undefined,
    [inboxCursorCollection]
  )
  const { data: inboxRows = [] } = useLiveQuery(
    (q) =>
      inboxCollection
        ? q.from({ i: inboxCollection }).orderBy(({ i }) => i.$key, `asc`)
        : undefined,
    [inboxCollection]
  )

  const meta = useMemo<CodingSessionMetaRow | undefined>(() => {
    const info = (sessionInfoRows as unknown as Array<SessionInfoRowShape>)[0]
    if (!info) return undefined
    const status = (runStatusRows as unknown as Array<RunStatusRowShape>)[0]
    return {
      key: info.key,
      agent: info.agent,
      cwd: info.cwd,
      electricSessionId: info.electricSessionId,
      ...(info.nativeSessionId !== undefined
        ? { nativeSessionId: info.nativeSessionId }
        : {}),
      status: status?.status ?? `initializing`,
      ...(status?.error !== undefined ? { error: status.error } : {}),
      ...(status?.currentPromptInboxKey !== undefined
        ? { currentPromptInboxKey: status.currentPromptInboxKey }
        : {}),
    } as CodingSessionMetaRow
  }, [sessionInfoRows, runStatusRows])

  const events = useMemo(() => {
    const real = eventRows as unknown as Array<CodingSessionEventRow>
    const cursor = (inboxCursorRows as unknown as Array<InboxCursorRowShape>)[0]
    const lastProcessed = cursor?.lastProcessedInboxKey ?? ``
    // Once a prompt's text shows up as a real user_message, drop the
    // pending bubble so the user doesn't see a duplicate below the
    // assistant's reply. Track remaining capacity per text so two
    // identical prompts in a row each get matched at most once.
    const realUserTextRemaining = new Map<string, number>()
    for (const r of real) {
      if (r.type !== `user_message`) continue
      const t = (r.payload as { text?: unknown }).text
      if (typeof t !== `string` || t.length === 0) continue
      realUserTextRemaining.set(t, (realUserTextRemaining.get(t) ?? 0) + 1)
    }
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
  }, [eventRows, inboxRows, inboxCursorRows])

  return { db: entityDb, events, meta, loading, error }
}
