import { createOptimisticAction } from '@tanstack/db'
import { createPendingTimelineOrder } from '@electric-ax/agents-runtime/client'
import { getActivePrincipal, serverFetch } from './auth-fetch'
import { entityApiUrl } from './entity-api'
import type {
  CommentSnapshot,
  CommentTarget,
  EntityStreamDBWithActions,
  EntityTimelineCommentRow,
} from '@electric-ax/agents-runtime/client'

const OPTIMISTIC_COMMENT_ORDER_START = Number.MAX_SAFE_INTEGER - 2_000_000

let optimisticCommentOrderIndex = OPTIMISTIC_COMMENT_ORDER_START

export type OptimisticComment = EntityTimelineCommentRow & {
  _timeline_order: string
}

export type SelectedCommentTarget = {
  target: CommentTarget
  snapshot: CommentSnapshot
}

type SendCommentInput = {
  key: string
  body: string
  replyTo?: CommentTarget
  targetSnapshot?: CommentSnapshot
  pendingOrderIndex: number
}

function nextOptimisticCommentOrderIndex(): number {
  optimisticCommentOrderIndex += 1
  if (optimisticCommentOrderIndex >= Number.MAX_SAFE_INTEGER) {
    optimisticCommentOrderIndex = OPTIMISTIC_COMMENT_ORDER_START
  }
  return optimisticCommentOrderIndex
}

function createClientCommentKey(pendingOrderIndex: number): string {
  return `client-comment-${Date.now()}-${pendingOrderIndex}`
}

function readCommentError(status: number, body: string): Error {
  let message = `Failed to post comment (${status})`
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

export function createSendCommentAction({
  db,
  baseUrl,
  entityUrl,
  from,
  onOptimisticComment,
}: {
  db: EntityStreamDBWithActions
  baseUrl: string
  entityUrl: string
  from?: string
  onOptimisticComment?: (comment: OptimisticComment) => void
}) {
  const action = createOptimisticAction<SendCommentInput>({
    onMutate: ({ key, body, replyTo, targetSnapshot, pendingOrderIndex }) => {
      const now = new Date().toISOString()
      const comment: OptimisticComment = {
        key,
        order: createPendingTimelineOrder(pendingOrderIndex),
        _timeline_order: createPendingTimelineOrder(pendingOrderIndex),
        body,
        from: from ?? getActivePrincipal(),
        timestamp: now,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(targetSnapshot ? { target_snapshot: targetSnapshot } : {}),
      }
      onOptimisticComment?.(comment)
      db.collections.comments.insert(comment)
    },
    mutationFn: async ({ key, body, replyTo, targetSnapshot }) => {
      const now = new Date().toISOString()
      const value = {
        body,
        timestamp: now,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(targetSnapshot ? { target_snapshot: targetSnapshot } : {}),
      }
      const res = await serverFetch(
        entityApiUrl(baseUrl, entityUrl, `/collections/comments`),
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ operation: `insert`, key, value }),
        }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => ``)
        throw readCommentError(res.status, body)
      }
    },
  })

  return ({
    body,
    replyTo,
    targetSnapshot,
  }: {
    body: string
    replyTo?: CommentTarget
    targetSnapshot?: CommentSnapshot
  }) => {
    const pendingOrderIndex = nextOptimisticCommentOrderIndex()
    return action({
      key: createClientCommentKey(pendingOrderIndex),
      body,
      replyTo,
      targetSnapshot,
      pendingOrderIndex,
    })
  }
}
