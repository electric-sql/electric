import { createOptimisticAction } from '@tanstack/db'
import { createPendingTimelineOrder } from '@electric-ax/agents-runtime/client'
import { getActivePrincipal, serverFetch } from './auth-fetch'
import { entityApiUrl } from './entity-api'
import type {
  EntityStreamDBWithActions,
  EntityTimelineQueryRow as RuntimeEntityTimelineQueryRow,
} from '@electric-ax/agents-runtime/client'

const OPTIMISTIC_COMMENT_ORDER_START = Number.MAX_SAFE_INTEGER - 2_000_000

let optimisticCommentOrderIndex = OPTIMISTIC_COMMENT_ORDER_START

/**
 * Wire-level shape of the `comment` custom collection. Comments are a
 * custom collection declared by the entity types that accept them
 * (horton, worker): each type registers a JSON Schema in
 * `custom_collection_schemas.comment`, and the server validates every
 * write through the generic `/collections/comment` endpoint against
 * that schema. Clients register the matching TanStack DB collection at
 * StreamDB construction time (see `useEntityTimeline`).
 */
export type CommentTargetCollection =
  | `inbox`
  | `run`
  | `text`
  | `tool_call`
  | `wake`
  | `signal`
  | `manifest`

export type CommentTarget =
  | {
      kind: `comment`
      key: string
    }
  | {
      kind: `timeline`
      collection: CommentTargetCollection
      key: string
      run_id?: string
    }

export type CommentSnapshot = {
  label: string
  text?: string
  from?: string
  timestamp?: string
  collection?: string
}

export type CommentRow = {
  key: string
  body: string
  from_principal: string
  timestamp: string
  reply_to?: CommentTarget
  target_snapshot?: CommentSnapshot
  edited_at?: string
  deleted_at?: string
  deleted_by?: string
  _seq?: number
  _timeline_order?: string
}

/**
 * Comment shaped for rendering by the timeline (mirrors the row union the
 * runtime emits for built-ins like inbox or run, with `order` resolved).
 */
export type EntityTimelineCommentRow = Omit<
  CommentRow,
  `_seq` | `_timeline_order`
> & {
  order: string | number
}

/**
 * Timeline row union for the UI. `useEntityTimeline` projects the runtime's
 * generic `custom` variant into a domain-specific `comment` variant for
 * comments, so consumers can write `if (row.comment)` instead of inspecting
 * `row.custom.collection`.
 */
type RuntimeBuiltInRow = Exclude<
  RuntimeEntityTimelineQueryRow,
  { custom: { collection: string } }
>
type WithCommentSlot<T extends object> = T & { comment?: undefined }
export type EntityTimelineQueryRow =
  | WithCommentSlot<RuntimeBuiltInRow>
  | {
      $key: string
      inbox?: undefined
      run?: undefined
      wake?: undefined
      signal?: undefined
      manifest?: undefined
      comment: EntityTimelineCommentRow
    }

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
        from_principal: from ?? getActivePrincipal(),
        timestamp: now,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(targetSnapshot ? { target_snapshot: targetSnapshot } : {}),
      }
      onOptimisticComment?.(comment)
      ;(db.collections as Record<string, any>).comments.insert(comment)
    },
    mutationFn: async ({ key, body, replyTo, targetSnapshot }) => {
      const now = new Date().toISOString()
      const value = {
        body,
        from_principal: from ?? getActivePrincipal(),
        timestamp: now,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(targetSnapshot ? { target_snapshot: targetSnapshot } : {}),
      }
      const res = await serverFetch(
        entityApiUrl(baseUrl, entityUrl, `/collections/comment`),
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ key, value }),
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
