import { serverFetch } from './auth-fetch'
import { createOptimisticAction } from '@tanstack/db'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'

// Timeline queries sort inbox messages by `_seq`. Pending local rows do not
// have a server sequence yet, so put them after streamed rows until the real
// event with the same key arrives.
const OPTIMISTIC_INBOX_SEQ_START = Number.MAX_SAFE_INTEGER - 1_000_000

let optimisticInboxSeq = OPTIMISTIC_INBOX_SEQ_START

type OptimisticInboxMessage = {
  key: string
  _seq: number
  from: string
  payload: { text: string }
  timestamp: string
}

type SendMessageInput = {
  text: string
  key: string
  seq: number
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

export function createSendMessageAction({
  db,
  baseUrl,
  entityUrl,
  from = `user`,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
  from?: string
}) {
  const action = createOptimisticAction<SendMessageInput>({
    onMutate: ({ text, key, seq }) => {
      const message: OptimisticInboxMessage = {
        key,
        _seq: seq,
        from,
        payload: { text },
        timestamp: new Date().toISOString(),
      }
      db.collections.inbox.insert(message)
    },
    mutationFn: async ({ text, key }) => {
      const res = await serverFetch(`${baseUrl}${entityUrl}/send`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ from, key, payload: { text } }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readSendError(res.status, body)
      }
    },
  })

  return ({ text }: { text: string }) => {
    const seq = nextOptimisticInboxSeq()
    return action({ text, key: createOptimisticInboxKey(seq), seq })
  }
}
