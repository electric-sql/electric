import { createOptimisticAction } from '@tanstack/db'
import { generateKeyBetween } from 'fractional-indexing'
import {
  COMPOSER_INPUT_MESSAGE_TYPE,
  createPendingTimelineOrder,
} from '@electric-ax/agents-runtime/client'
import { getActivePrincipal, serverFetch } from './auth-fetch'
import { entityApiUrl } from './entity-api'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import type { ComposerInputPayload } from '@electric-ax/agents-runtime/client'

// Pending local rows do not have a server stream offset yet, so put them after
// streamed rows until the real event with the same key arrives.
const OPTIMISTIC_INBOX_ORDER_START = Number.MAX_SAFE_INTEGER - 1_000_000

let optimisticInboxOrderIndex = OPTIMISTIC_INBOX_ORDER_START

export type OptimisticInboxMessage = {
  key: string
  _timeline_order: string
  from: string
  from_principal?: string
  payload: { text: string } | ComposerInputPayload
  message_type?: string
  timestamp: string
  mode: `immediate` | `queued` | `paused` | `steer`
  status: `pending` | `processed` | `cancelled`
  position?: string
  processed_at?: string
}

/**
 * A React Native file part: RN's `FormData` serializes a `{ uri, name, type }`
 * object into a multipart file part rather than a browser `File`/`Blob`. The
 * web composer passes real `File`s; the mobile composer passes these.
 */
export type NativeFileDescriptor = { uri: string; name: string; type: string }

export type AttachmentInput = File | NativeFileDescriptor

type SendMessageInput = {
  payload: { text: string } | ComposerInputPayload
  type?: string
  mode: `immediate` | `queued` | `paused` | `steer`
  key: string
  pendingOrderIndex: number
  position?: string
  attachments?: Array<AttachmentInput>
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

function createOptimisticInboxKey(pendingOrderIndex: number): string {
  return `optimistic-${Date.now()}-${pendingOrderIndex}`
}

export function createClientInboxKey(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createClientAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? createClientInboxKey()
}

function isNativeFileDescriptor(
  file: AttachmentInput
): file is NativeFileDescriptor {
  // RN file parts are plain `{ uri, name, type }` objects; browser File/Blob
  // instances expose `arrayBuffer()` — detect by a `uri` plus its absence.
  return (
    typeof (file as { uri?: unknown }).uri === `string` &&
    typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== `function`
  )
}

function nextOptimisticInboxOrderIndex(): number {
  optimisticInboxOrderIndex += 1
  if (optimisticInboxOrderIndex >= Number.MAX_SAFE_INTEGER) {
    optimisticInboxOrderIndex = OPTIMISTIC_INBOX_ORDER_START
  }
  return optimisticInboxOrderIndex
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

function readRequiredTxid(data: { txid?: unknown }, label: string): string {
  if (typeof data.txid !== `string`) {
    throw new Error(`${label} returned an invalid txid response`)
  }
  return data.txid
}

const NULL_BODY_STATUSES = new Set([204, 205, 304])

async function readOptionalJson<T>(res: Response): Promise<T | null> {
  if (NULL_BODY_STATUSES.has(res.status)) return null
  const raw = await res.text().catch(() => ``)
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`Response body was not valid JSON`)
  }
}

async function readRequiredJson<T>(res: Response): Promise<T> {
  const data = await readOptionalJson<T>(res)
  if (data === null) {
    throw new Error(`Response body was empty`)
  }
  return data
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

export async function uploadMessageAttachments({
  baseUrl,
  entityUrl,
  key,
  attachments,
}: {
  baseUrl: string
  entityUrl: string
  key: string
  attachments: Array<AttachmentInput> | undefined
}): Promise<{ ids: Array<string>; txids: Array<string> }> {
  if (!attachments || attachments.length === 0) {
    return { ids: [], txids: [] }
  }

  const uploadedIds: Array<string> = []
  const txids: Array<string> = []
  try {
    for (const file of attachments) {
      const id = createClientAttachmentId()
      uploadedIds.push(id)
      const form = new FormData()
      // RN's FormData implements `append` but not `set`, and serializes a
      // `{ uri, name, type }` object into the file part; the browser path keeps
      // `set` + the real File. Both share the same (name, value, filename?)
      // signature, so a single bound method covers both.
      const addField = isNativeFileDescriptor(file)
        ? form.append.bind(form)
        : form.set.bind(form)
      addField(`id`, id)
      // The native descriptor isn't a Blob, but RN's FormData accepts it here.
      addField(`file`, file as unknown as Blob, file.name || `attachment`)
      addField(`subject`, JSON.stringify({ type: `inbox`, key }))
      addField(`role`, `input`)
      if (file.type) {
        addField(`mimeType`, file.type)
      }
      if (file.name) {
        addField(`filename`, file.name)
      }

      const res = await serverFetch(
        entityApiUrl(baseUrl, entityUrl, `/attachments`),
        {
          method: `POST`,
          body: form,
        }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
      const data = await readRequiredJson<{
        txid?: unknown
        attachment?: { id?: unknown }
      }>(res)
      txids.push(readRequiredTxid(data, `Attachment upload`))
      if (data.attachment?.id !== id) {
        throw new Error(`Attachment upload returned an invalid response`)
      }
    }
  } catch (error) {
    await deleteUploadedAttachments({ baseUrl, entityUrl, ids: uploadedIds })
    throw error
  }

  return { ids: uploadedIds, txids }
}

async function deleteUploadedAttachments({
  baseUrl,
  entityUrl,
  ids,
}: {
  baseUrl: string
  entityUrl: string
  ids: Array<string>
}): Promise<void> {
  if (ids.length === 0) return
  await Promise.allSettled(
    ids.map((id) =>
      serverFetch(
        entityApiUrl(
          baseUrl,
          entityUrl,
          `/attachments/${encodeURIComponent(id)}`
        ),
        { method: `DELETE` }
      )
    )
  )
}

export async function sendEntityMessage({
  baseUrl,
  entityUrl,
  text,
  payload: explicitPayload,
  type,
  key = createClientInboxKey(),
  mode = `queued`,
  position,
  attachments,
}: {
  baseUrl: string
  entityUrl: string
  text?: string
  payload?: { text: string } | ComposerInputPayload
  type?: string
  key?: string
  mode?: `immediate` | `queued` | `paused` | `steer`
  position?: string
  attachments?: Array<AttachmentInput>
}): Promise<{ txid: string; attachmentTxids: Array<string> }> {
  const url = entityApiUrl(baseUrl, entityUrl, `/send`)
  const uploadedAttachments = await uploadMessageAttachments({
    baseUrl,
    entityUrl,
    key,
    attachments,
  })
  const effectivePayload = explicitPayload ?? { text: text ?? `` }
  try {
    const res = await serverFetch(url, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        key,
        payload: effectivePayload,
        mode,
        position,
        type,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => ``)
      throw readSendError(res.status, body)
    }
    const data = await readRequiredJson<{ txid?: unknown }>(res)
    const txid = readRequiredTxid(data, `Send`)
    return { txid, attachmentTxids: uploadedAttachments.txids }
  } catch (error) {
    await deleteUploadedAttachments({
      baseUrl,
      entityUrl,
      ids: uploadedAttachments.ids,
    })
    throw error
  }
}

export function readTextPayload(payload: unknown): string {
  if (typeof payload === `string`) return payload
  if (payload && typeof payload === `object`) {
    // Prefer the canonical `text` key (what the chat input emits and what
    // the `send` tool's description recommends), then fall back to
    // `message` / `content` / `source` since agents sometimes emit those
    // when the shape guidance isn't internalised. Keeps casually-shaped
    // agent-to-agent sends visible in the chat instead of rendering blank.
    const candidates = [`text`, `message`, `content`, `source`] as const
    for (const key of candidates) {
      const value = (payload as Record<string, unknown>)[key]
      if (typeof value === `string`) return value
    }
  }
  return ``
}

export function createSendMessageAction({
  db,
  baseUrl,
  entityUrl,
  from,
  onOptimisticMessage,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
  from?: string
  onOptimisticMessage?: (message: OptimisticInboxMessage) => void
}) {
  const action = createOptimisticAction<SendMessageInput>({
    onMutate: ({ payload, type, mode, key, pendingOrderIndex, position }) => {
      const sender = from ?? getActivePrincipal()
      const now = new Date().toISOString()
      const message: OptimisticInboxMessage = {
        key,
        _timeline_order: createPendingTimelineOrder(pendingOrderIndex),
        from: sender,
        from_principal: sender,
        payload,
        ...(type ? { message_type: type } : {}),
        timestamp: now,
        mode,
        status:
          mode === `queued` || mode === `paused` ? `pending` : `processed`,
        ...(position ? { position } : {}),
        ...(mode === `queued` || mode === `paused`
          ? {}
          : { processed_at: now }),
      }
      onOptimisticMessage?.(message)
      db.collections.inbox.insert(message)
    },
    mutationFn: async ({ payload, type, key, mode, position, attachments }) => {
      if (attachments && attachments.length > 0) {
        const { txid, attachmentTxids } = await sendEntityMessage({
          baseUrl,
          entityUrl,
          payload,
          type,
          key,
          mode,
          position,
          attachments,
        })
        await Promise.all([
          ...attachmentTxids.map((id) => db.utils.awaitTxId(id, 10_000)),
          db.utils.awaitTxId(txid, 10_000),
        ])
        return
      }
      const url = entityApiUrl(baseUrl, entityUrl, `/send`)
      const res = await serverFetch(url, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          key,
          payload,
          mode,
          type,
          position,
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
      const data = await readRequiredJson<{ txid?: unknown }>(res)
      await db.utils.awaitTxId(readRequiredTxid(data, `Send`), 10_000)
    },
  })

  return ({
    text,
    payload,
    type,
    mode = `queued`,
    position,
    attachments,
  }: {
    text?: string
    payload?: { text: string } | ComposerInputPayload
    type?: string
    mode?: `immediate` | `queued` | `paused` | `steer`
    position?: string
    attachments?: Array<AttachmentInput>
  }) => {
    const pendingOrderIndex = nextOptimisticInboxOrderIndex()
    const effectivePosition =
      position ??
      (mode === `queued` || mode === `paused`
        ? createInitialQueuePosition()
        : undefined)
    const effectivePayload = payload ?? { text: text ?? `` }
    return action({
      payload: effectivePayload,
      type,
      mode,
      key: createOptimisticInboxKey(pendingOrderIndex),
      pendingOrderIndex,
      position: effectivePosition,
      attachments,
    })
  }
}

export function createSendComposerInputAction(args: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
  from?: string
  onOptimisticMessage?: (message: OptimisticInboxMessage) => void
}) {
  const sendMessage = createSendMessageAction(args)
  return ({
    payload,
    mode = `queued`,
    attachments,
  }: {
    payload: ComposerInputPayload
    mode?: `immediate` | `queued` | `paused` | `steer`
    attachments?: Array<AttachmentInput>
  }) =>
    sendMessage({
      payload,
      type: COMPOSER_INPUT_MESSAGE_TYPE,
      mode,
      attachments,
    })
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
      const data = await readRequiredJson<{ txid?: unknown }>(res)
      await db.utils.awaitTxId(readRequiredTxid(data, `Inbox update`), 10_000)
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
      const data = await readRequiredJson<{ txid?: unknown }>(res)
      await db.utils.awaitTxId(readRequiredTxid(data, `Inbox delete`), 10_000)
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
      const data = await readRequiredJson<{ txid?: unknown }>(res)
      await db.utils.awaitTxId(readRequiredTxid(data, `Inbox steer`), 10_000)
    },
  })
}
