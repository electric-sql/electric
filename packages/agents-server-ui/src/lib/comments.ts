import { createOptimisticAction } from '@tanstack/db'
import { coalesce } from '@durable-streams/state/db'
import {
  createPendingTimelineOrder,
  TIMELINE_ORDER_FALLBACK,
} from '@electric-ax/agents-runtime/client'
import { getActivePrincipal, serverFetch } from './auth-fetch'
import { isAttachmentManifest } from './attachments'
import { entityApiUrl } from './entity-api'
import type {
  CommentSnapshot,
  CommentTarget,
  EntityStreamDBWithActions,
  EntityTimelineExtraSource,
  EntityTimelineQueryRow,
} from '@electric-ax/agents-runtime/client'

/**
 * Comments are a UI-level concern: the runtime timeline query knows nothing
 * about them. `useEntityTimeline` merges them in by passing
 * `createCommentsTimelineSource` as an extra timeline source.
 */
export type EntityTimelineCommentRow = {
  key: string
  order: string
  body: string
  from: string
  timestamp: string
  reply_to?: CommentTarget
  target_snapshot?: CommentSnapshot
  edited_at?: string
  deleted_at?: string
  deleted_by?: string
}

export type CommentTimelineRow = {
  $key: string
  comment: EntityTimelineCommentRow
  inbox?: undefined
  run?: undefined
  wake?: undefined
  signal?: undefined
  manifest?: undefined
}

/** Timeline row as consumed by UI views: runtime rows plus merged comment rows. */
export type TimelineRow =
  | (EntityTimelineQueryRow & { comment?: undefined })
  | CommentTimelineRow

/**
 * Timeline source for the `comments` collection, passed to the runtime's
 * `createEntityTimelineQuery` via `extraSources`. The author resolves from
 * the `_principal` virtual column (server-stamped, spoof-proof), falling back
 * to the optimistic row's `from`.
 */
export function createCommentsTimelineSource(
  db: EntityStreamDBWithActions
): EntityTimelineExtraSource {
  const comments = (db.collections as Record<string, any>).comments
  return (q) =>
    q.from({ comment: comments }).select(({ comment }: any) => ({
      order: coalesce(comment._timeline_order, TIMELINE_ORDER_FALLBACK),
      key: comment.key,
      body: comment.body,
      from: coalesce(comment._principal?.url, comment.from, ``),
      timestamp: coalesce(comment.timestamp, ``),
      reply_to: comment.reply_to,
      target_snapshot: comment.target_snapshot,
      edited_at: comment.edited_at,
      deleted_at: comment.deleted_at,
      deleted_by: comment.deleted_by,
    }))
}

const OPTIMISTIC_COMMENT_ORDER_START = Number.MAX_SAFE_INTEGER - 2_000_000

let optimisticCommentOrderIndex = OPTIMISTIC_COMMENT_ORDER_START

export type OptimisticComment = EntityTimelineCommentRow & {
  _timeline_order: string
  _principal?: { url: string }
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
      const principalUrl = from ?? getActivePrincipal()
      const comment: OptimisticComment = {
        key,
        order: createPendingTimelineOrder(pendingOrderIndex),
        _timeline_order: createPendingTimelineOrder(pendingOrderIndex),
        body,
        from: principalUrl,
        _principal: { url: principalUrl },
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

export const COMMENT_FOCUS_PARAM = `focus`

const COMMENT_TARGET_COLLECTIONS = new Set<string>([
  `inbox`,
  `run`,
  `text`,
  `tool_call`,
  `wake`,
  `signal`,
  `manifest`,
])

export function encodeCommentTargetParam(target: CommentTarget): string {
  return encodeURIComponent(JSON.stringify(target))
}

export function decodeCommentTargetParam(
  value: string | undefined
): CommentTarget | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(decodeURIComponent(value)) as unknown
    if (!isCommentTarget(decoded)) return null
    return decoded
  } catch {
    return null
  }
}

export function commentFocusViewParams(
  target: CommentTarget
): Record<string, string> {
  return { [COMMENT_FOCUS_PARAM]: encodeCommentTargetParam(target) }
}

function isCommentTarget(value: unknown): value is CommentTarget {
  if (!value || typeof value !== `object`) return false
  const target = value as Partial<CommentTarget>
  if (target.kind === `comment`) {
    return typeof target.key === `string`
  }
  if (target.kind !== `timeline`) return false
  const timelineTarget = target as Partial<
    Extract<CommentTarget, { kind: `timeline` }>
  >
  return (
    typeof timelineTarget.key === `string` &&
    typeof timelineTarget.collection === `string` &&
    COMMENT_TARGET_COLLECTIONS.has(timelineTarget.collection) &&
    (timelineTarget.run_id === undefined ||
      typeof timelineTarget.run_id === `string`)
  )
}

export type TimelineRowAdjacency = {
  previousRow?: TimelineRow
  nextRow?: TimelineRow
}

/**
 * Comment-only timeline: keeps just the comment rows, recording each one's
 * neighboring renderable rows so the view can show surrounding context.
 */
export function buildCommentsTimeline(timelineRows: Array<TimelineRow>): {
  rows: Array<TimelineRow>
  adjacency: Array<TimelineRowAdjacency>
} {
  const rows: Array<TimelineRow> = []
  const adjacency: Array<TimelineRowAdjacency> = []
  let previousRenderableRow: TimelineRow | undefined
  let pendingCommentAdjacencyIndex: number | null = null

  for (const row of timelineRows) {
    if (isAttachmentManifest(row.manifest)) continue

    if (pendingCommentAdjacencyIndex !== null) {
      const pendingAdjacency = adjacency[pendingCommentAdjacencyIndex]!
      adjacency[pendingCommentAdjacencyIndex] = {
        ...pendingAdjacency,
        nextRow: row,
      }
      pendingCommentAdjacencyIndex = null
    }

    if (row.comment) {
      rows.push(row)
      adjacency.push({
        previousRow: previousRenderableRow,
      })
      pendingCommentAdjacencyIndex = adjacency.length - 1
    }

    previousRenderableRow = row
  }

  return { rows, adjacency }
}
