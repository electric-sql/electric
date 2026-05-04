/**
 * Schema and helpers for the coding-session **resource** — the durable,
 * shareable, forkable representation of a coder's state.
 *
 * Background. Originally the coder entity owned three of its own
 * collections (`sessionMeta`, `cursorState`, `events`) and the entity
 * was the canonical home for the session's history. That couples the
 * history to one entity instance — fine for "open a coder, send some
 * prompts" but awkward when you want to fork the session, attach a
 * second entity to it, share a session URL, or surface it in a
 * specialised viewer outside any one entity's lifecycle.
 *
 * The resource pattern fixes that. The history (events + the static
 * facts about *which* session this is) lives in a shared-state DB at
 * a stable id (`coder-session/<entityId>`). The wrapper coder entity
 * just observes/appends to it. Because shared-state DBs are
 * server-side first-class streams, multiple entities can attach, the
 * stream survives the entity, and the server already knows how to
 * fork-rewrite shared-state ids when entities are forked.
 */
import { z } from 'zod'
import type { SharedStateSchemaMap } from './types'

/** Collection event-type strings (mirror of the entity-collection naming convention). */
export const CODING_SESSION_RESOURCE_INFO_TYPE = `coding_session_info`
export const CODING_SESSION_RESOURCE_TRANSCRIPT_TYPE = `coding_session_transcript`

/**
 * Static facts about a coding session that don't change as it runs.
 * `nativeSessionId` becomes set once the CLI assigns one (after the
 * first turn for a fresh session, or up front for an attached/imported
 * one). `electricSessionId` matches the slug of the wrapper entity
 * that originally created the resource.
 */
export const codingSessionInfoRowSchema = z.object({
  key: z.literal(`current`),
  agent: z.enum([`claude`, `codex`]),
  cwd: z.string(),
  electricSessionId: z.string(),
  nativeSessionId: z.string().optional(),
  createdAt: z.number(),
})
export type CodingSessionInfoRow = z.infer<typeof codingSessionInfoRowSchema>

/**
 * One normalized event from the agent-session-protocol stream. Same
 * shape the entity used to write into its events collection. Lives
 * under the resource's `transcript` collection — *not* `events`,
 * because the runtime's `ObservationHandle` reserves the field name
 * `events` (for raw `ChangeEvent`s) and would silently shadow a
 * collection with that name when we attach via `observe(db(...))`.
 */
export const codingSessionTranscriptRowSchema = z.object({
  key: z.string(),
  ts: z.number(),
  type: z.string(),
  callId: z.string().optional(),
  payload: z.looseObject({}),
})
export type CodingSessionTranscriptRow = z.infer<
  typeof codingSessionTranscriptRowSchema
>

/**
 * The shape of a coding-session resource. Both collections live on a
 * single shared-state DB — there's no reason to split them, and
 * keeping them together lets observers attach with one `db(...)` call.
 */
export const codingSessionResourceSchema = {
  sessionInfo: {
    schema: codingSessionInfoRowSchema,
    type: CODING_SESSION_RESOURCE_INFO_TYPE,
    primaryKey: `key`,
  },
  transcript: {
    schema: codingSessionTranscriptRowSchema,
    type: CODING_SESSION_RESOURCE_TRANSCRIPT_TYPE,
    primaryKey: `key`,
  },
} as const satisfies SharedStateSchemaMap

export type CodingSessionResourceSchema = typeof codingSessionResourceSchema

/**
 * Default resource id for a coder entity. The wrapper entity stores
 * this on its tags as `coderResource` so observers (e.g. the UI) can
 * look up the entity, read the tag, and connect to the resource
 * stream without needing a separate registry.
 */
export function codingSessionResourceId(entityId: string): string {
  return `coder-session/${entityId}`
}

/** Tag key used by the coder entity to point at its resource. */
export const CODER_RESOURCE_TAG = `coderResource`
