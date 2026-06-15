import { z } from 'zod'
import type { CollectionDefinition } from './types'

export type CommentTargetValue =
  | { kind: `comment`; key: string }
  | {
      kind: `timeline`
      collection:
        | `inbox`
        | `run`
        | `text`
        | `tool_call`
        | `wake`
        | `signal`
        | `manifest`
      key: string
      run_id?: string
    }

export type CommentSnapshotValue = {
  label: string
  text?: string
  from?: string
  timestamp?: string
  collection?: string
}

export type CommentValue = {
  key?: string
  body: string
  timestamp: string
  reply_to?: CommentTargetValue
  target_snapshot?: CommentSnapshotValue
}

const commentTargetSchema = z.union([
  z.object({ kind: z.literal(`comment`), key: z.string() }),
  z.object({
    kind: z.literal(`timeline`),
    collection: z.enum([
      `inbox`,
      `run`,
      `text`,
      `tool_call`,
      `wake`,
      `signal`,
      `manifest`,
    ]),
    key: z.string(),
    run_id: z.string().optional(),
  }),
])

const commentSnapshotSchema = z.object({
  label: z.string(),
  text: z.string().optional(),
  from: z.string().optional(),
  timestamp: z.string().optional(),
  collection: z.string().optional(),
})

export const commentSchema = z.object({
  key: z.string().optional(),
  body: z.string(),
  timestamp: z.string(),
  reply_to: commentTargetSchema.optional(),
  target_snapshot: commentSnapshotSchema.optional(),
})

/**
 * Contract identifier for the canonical comments collection. The server
 * reserves the `comments` collection name for this contract, and the UI
 * only surfaces comment affordances for entity types whose registration
 * advertises it — so an agent's unrelated `comments` state can never be
 * mistaken for platform comments.
 */
export const COMMENTS_CONTRACT = `comments/v1`

export const commentsCollection: CollectionDefinition = {
  schema: commentSchema,
  type: `state:comments`,
  primaryKey: `key`,
  externallyWritable: true,
  contract: COMMENTS_CONTRACT,
  // Insert-only: comments are append-only events. Update/delete would let a
  // client overwrite or remove another principal's comment by key. Edit and
  // soft-delete flows are deferred; their ops can be added here when they land.
  operations: [`insert`],
}
