import { createOptimisticAction } from '@tanstack/db'
import { generateKeyBetween } from 'fractional-indexing'
import { createPendingTimelineOrder } from '@electric-ax/agents-runtime/client'
import {
  getActivePrincipal,
  getConfiguredServerHeaders,
  serverFetch,
} from './auth-fetch'
import { entityApiUrl } from './entity-api'
import { loadCloudAuthState } from './server-connection'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'

// Timeline queries sort inbox messages by `_seq`. Pending local rows do not
// have a server sequence yet, so put them after streamed rows until the real
// event with the same key arrives.
const OPTIMISTIC_INBOX_SEQ_START = Number.MAX_SAFE_INTEGER - 1_000_000

let optimisticInboxSeq = OPTIMISTIC_INBOX_SEQ_START

export type OptimisticInboxMessage = {
  key: string
  _seq: number
  _timeline_order: string
  from: string
  payload: { text: string }
  timestamp: string
  mode: `immediate` | `queued` | `paused` | `steer`
  status: `pending` | `processed` | `cancelled`
  position?: string
  processed_at?: string
}

type SendMessageInput = {
  text: string
  mode: `immediate` | `queued` | `paused` | `steer`
  key: string
  seq: number
  position?: string
}

type UpdateInboxMessageInput = {
  key: string
  text?: string
  position?: string
  mode?: `immediate` | `queued` | `paused` | `steer`
  status?: `pending` | `processed` | `cancelled`
}

type InboxMessageKeyInput = {
  key: string
}

function createOptimisticInboxKey(seq: number): string {
  return `optimistic-${Date.now()}-${seq}`
}

function nextOptimisticInboxSeq(): number {
  optimisticInboxSeq += 1
  if (optimisticInboxSeq >= Number.MAX_SAFE_INTEGER) {
    optimisticInboxSeq = OPTIMISTIC_INBOX_SEQ_START
  }
  return optimisticInboxSeq
}

const QUEUE_POSITION_TIMESTAMP_WIDTH = 16
const QUEUE_POSITION_SEPARATOR = `:`

function padQueueTimestamp(timestamp: number): string {
  return String(Math.max(0, Math.floor(timestamp))).padStart(
    QUEUE_POSITION_TIMESTAMP_WIDTH,
    `0`
  )
}

function parseQueuePosition(position: string | undefined): {
  timestamp: string
  index: string | null
} | null {
  if (!position) return null
  const match = /^(\d{16})(?::(.+))?$/.exec(position)
  if (!match) return null
  return { timestamp: match[1]!, index: match[2] ?? null }
}

function formatQueuePosition(timestamp: string, index: string): string {
  return `${timestamp}${QUEUE_POSITION_SEPARATOR}${index}`
}

export function createInitialQueuePosition(now = Date.now()): string {
  return formatQueuePosition(
    padQueueTimestamp(now),
    generateKeyBetween(null, null)
  )
}

export function createQueuePositionBetween(
  previousPosition: string | undefined,
  nextPosition: string | undefined
): string {
  const previous = parseQueuePosition(previousPosition)
  const next = parseQueuePosition(nextPosition)

  if (previous && next && previous.timestamp === next.timestamp) {
    return formatQueuePosition(
      previous.timestamp,
      generateKeyBetween(previous.index, next.index)
    )
  }

  if (previous) {
    return formatQueuePosition(
      previous.timestamp,
      generateKeyBetween(previous.index, null)
    )
  }

  if (next) {
    if (next.index !== null) {
      return formatQueuePosition(
        next.timestamp,
        generateKeyBetween(null, next.index)
      )
    }
    return formatQueuePosition(
      padQueueTimestamp(Number(next.timestamp) - 1),
      generateKeyBetween(null, null)
    )
  }

  return createInitialQueuePosition()
}

function readSendError(status: number, body: string): Error {
  let message = `Send failed (${status})`
  if (body) {
    try {
      const data = JSON.parse(body) as Record<string, unknown>
      if (data.message) message = String(data.message)
    } catch {
      message = body
    }
  }
  return new Error(message)
}

export function readTextPayload(payload: unknown): string {
  if (payload && typeof payload === `object`) {
    const text = (payload as { text?: unknown }).text
    if (typeof text === `string`) return text
  }
  return typeof payload === `string` ? payload : ``
}

function principalUrl(principalKey: string): string {
  return `/principal/${encodeURIComponent(principalKey)}`
}

function principalUrlFromConfiguredHeaders(url: string): string | null {
  const headers = new Headers(getConfiguredServerHeaders(url))
  const principal = headers.get(`electric-principal`)?.trim()
  return principal ? principalUrl(principal) : null
}

async function resolveSenderPrincipalUrl(
  url: string,
  from: string
): Promise<string> {
  if (from.startsWith(`/principal/`)) return from

  const headerPrincipal = principalUrlFromConfiguredHeaders(url)
  if (headerPrincipal) return headerPrincipal

  const cloudAuth = await loadCloudAuthState().catch(() => null)
  if (cloudAuth?.status === `signed-in` && cloudAuth.userId) {
    return principalUrl(`user:${cloudAuth.userId}`)
  }

  return principalUrl(`system:dev-local`)
}

export function createSendMessageAction({
  db,
  baseUrl,
  entityUrl,
  from = getActivePrincipal(),
  onOptimisticMessage,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
  from?: string
  onOptimisticMessage?: (message: OptimisticInboxMessage) => void
}) {
  const action = createOptimisticAction<SendMessageInput>({
    onMutate: ({ text, mode, key, seq, position }) => {
      const now = new Date().toISOString()
      const message: OptimisticInboxMessage = {
        key,
        _seq: seq,
        _timeline_order: createPendingTimelineOrder(seq),
        from,
        payload: { text },
        timestamp: now,
        mode,
        status:
          mode === `queued` || mode === `paused` ? `pending` : `processed`,
        ...(position ? { position } : {}),
        ...(mode === `queued` || mode === `paused`
          ? {}
          : { processed_at: now }),
      }
      db.collections.inbox.insert(message)
      onOptimisticMessage?.(message)
    },
    mutationFn: async ({ text, key, mode, position }) => {
      const url = entityApiUrl(baseUrl, entityUrl, `/send`)
      const sender = await resolveSenderPrincipalUrl(url, from)
      const res = await serverFetch(url, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          from: sender,
          key,
          payload: { text },
          mode,
          position,
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
    },
  })

  return ({
    text,
    mode = `queued`,
    position,
  }: {
    text: string
    mode?: `immediate` | `queued` | `paused` | `steer`
    position?: string
  }) => {
    const seq = nextOptimisticInboxSeq()
    const effectivePosition =
      position ??
      (mode === `queued` || mode === `paused`
        ? createInitialQueuePosition()
        : undefined)
    return action({
      text,
      mode,
      key: createOptimisticInboxKey(seq),
      seq,
      position: effectivePosition,
    })
  }
}

export function createUpdateInboxMessageAction({
  db,
  baseUrl,
  entityUrl,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
}) {
  return createOptimisticAction<UpdateInboxMessageInput>({
    onMutate: ({ key, text, position, mode, status }) => {
      db.collections.inbox.update(key, (draft) => {
        if (text !== undefined) {
          draft.payload = { text }
        }
        if (position !== undefined) {
          draft.position = position
        }
        if (mode !== undefined) {
          draft.mode = mode
        }
        if (status !== undefined) {
          draft.status = status
        }
      })
    },
    mutationFn: async ({ key, text, position, mode, status }) => {
      const body: {
        payload?: { text: string }
        position?: string
        mode?: `immediate` | `queued` | `paused` | `steer`
        status?: `pending` | `processed` | `cancelled`
      } = {}
      if (text !== undefined) {
        body.payload = { text }
      }
      if (position !== undefined) {
        body.position = position
      }
      if (mode !== undefined) {
        body.mode = mode
      }
      if (status !== undefined) {
        body.status = status
      }
      const res = await serverFetch(
        entityApiUrl(baseUrl, entityUrl, `/inbox/${encodeURIComponent(key)}`),
        {
          method: `PATCH`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
    },
  })
}

export function createDeleteInboxMessageAction({
  db,
  baseUrl,
  entityUrl,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
}) {
  return createOptimisticAction<InboxMessageKeyInput>({
    onMutate: ({ key }) => {
      db.collections.inbox.delete(key)
    },
    mutationFn: async ({ key }) => {
      const res = await serverFetch(
        entityApiUrl(baseUrl, entityUrl, `/inbox/${encodeURIComponent(key)}`),
        { method: `DELETE` }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
    },
  })
}

export function createSteerInboxMessageAction({
  db,
  baseUrl,
  entityUrl,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
}) {
  return createOptimisticAction<InboxMessageKeyInput>({
    onMutate: ({ key }) => {
      const now = new Date().toISOString()
      db.collections.inbox.update(key, (draft) => {
        draft.mode = `steer`
        draft.status = `processed`
        draft.processed_at = now
      })
    },
    mutationFn: async ({ key }) => {
      const res = await serverFetch(
        entityApiUrl(baseUrl, entityUrl, `/inbox/${encodeURIComponent(key)}`),
        {
          method: `PATCH`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ mode: `steer`, status: `processed` }),
        }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
    },
  })
}
