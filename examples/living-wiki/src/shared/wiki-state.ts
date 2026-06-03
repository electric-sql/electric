import {
  createStateSchema,
  type CollectionDefinition,
} from '@durable-streams/state'
import { z } from 'zod'

const boundedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max)
const idSchema = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9_-]+$`))

export const wikiSpaceIdSchema = idSchema(`wiki`)
export const actorIdSchema = idSchema(`actor`)
export const membershipIdSchema = idSchema(`membership`)
export const eventIdSchema = idSchema(`event`)
export const sourceIdSchema = idSchema(`source`)
export const wikiPageIdSchema = idSchema(`page`)
export const wikiLinkIdSchema = idSchema(`link`)
export const reviewItemIdSchema = idSchema(`review`)
export const agentRunIdSchema = z.string().regex(/^agent_run_[a-z0-9_-]+$/)
export const isoTimestampSchema = z.string().datetime({ offset: true })

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])
type JsonValue =
  | z.infer<typeof jsonPrimitiveSchema>
  | { [key: string]: JsonValue }
  | JsonValue[]
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema)

const nullableString = (min: number, max: number) =>
  boundedString(min, max).nullable()
const nullableTimestamp = isoTimestampSchema.nullable()

export const wikiSpaceSchema = z
  .object({
    id: wikiSpaceIdSchema,
    title: boundedString(1, 120),
    created_at: isoTimestampSchema,
    created_by_actor_id: actorIdSchema,
    status: z.enum([`active`, `archived`]),
  })
  .strict()

export const actorSchema = z
  .object({
    id: actorIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    kind: z.enum([`human`, `agent`]),
    display_name: boundedString(1, 80),
    avatar_color: boundedString(1, 32),
    created_at: isoTimestampSchema,
  })
  .strict()

export const membershipSchema = z
  .object({
    id: membershipIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    actor_id: actorIdSchema,
    role: z.enum([`owner`, `member`, `observer`]),
    joined_at: isoTimestampSchema,
    status: z.enum([`active`, `left`]),
  })
  .strict()

export const activityEventSchema = z
  .object({
    id: eventIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    occurred_at: isoTimestampSchema,
    actor_id: actorIdSchema,
    actor_kind: z.enum([`human`, `agent`]),
    event_type: boundedString(1, 80),
    summary: boundedString(1, 280),
    subject_type: boundedString(1, 80),
    subject_id: boundedString(1, 160),
    visibility: z.enum([`ambient`, `inspector`, `system`]),
    metadata: jsonObjectSchema,
  })
  .strict()

export const sourceSchema = z
  .object({
    id: sourceIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    kind: z.enum([`url`, `text`]),
    status: z.enum([`submitted`, `published`, `rejected`]),
    title: boundedString(1, 160),
    url: z.string().url().nullable(),
    text_preview: nullableString(1, 1000),
    submitted_by_actor_id: actorIdSchema,
    submitted_at: isoTimestampSchema,
    published_at: nullableTimestamp,
    metadata: jsonObjectSchema,
  })
  .strict()
  .superRefine((source, ctx) => {
    if (source.kind === `url` && source.url === null) {
      ctx.addIssue({
        code: `custom`,
        path: [`url`],
        message: `URL sources require a url`,
      })
    }
    if (source.kind === `text`) {
      if (source.url !== null)
        ctx.addIssue({
          code: `custom`,
          path: [`url`],
          message: `Text sources must not include a url`,
        })
      if (source.text_preview === null)
        ctx.addIssue({
          code: `custom`,
          path: [`text_preview`],
          message: `Text sources require a preview`,
        })
    }
    if (source.status === `published` && source.published_at === null) {
      ctx.addIssue({
        code: `custom`,
        path: [`published_at`],
        message: `Published sources require published_at`,
      })
    }
    if (source.status !== `published` && source.published_at !== null) {
      ctx.addIssue({
        code: `custom`,
        path: [`published_at`],
        message: `Unpublished sources must not include published_at`,
      })
    }
  })

export const wikiPageSchema = z
  .object({
    id: wikiPageIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/),
    title: boundedString(1, 160),
    status: z.enum([`proposed`, `canonical`, `rejected`]),
    summary: nullableString(1, 500),
    body: nullableString(1, 20_000),
    source_ids: z.array(sourceIdSchema).max(100),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    created_by_run_id: agentRunIdSchema.nullable(),
  })
  .strict()

export const wikiLinkSchema = z
  .object({
    id: wikiLinkIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    from_page_id: wikiPageIdSchema,
    to_page_id: wikiPageIdSchema,
    status: z.enum([`proposed`, `canonical`, `rejected`]),
    label: nullableString(1, 120),
    rationale: nullableString(1, 1000),
    source_ids: z.array(sourceIdSchema).max(100),
    created_at: isoTimestampSchema,
    created_by_run_id: agentRunIdSchema.nullable(),
  })
  .strict()

export const reviewItemSchema = z
  .object({
    id: reviewItemIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    kind: z.enum([`page`, `link`, `source`]),
    status: z.enum([`open`, `approved`, `rejected`]),
    target_type: boundedString(1, 80),
    target_id: boundedString(1, 160),
    suggested_change: boundedString(1, 2000),
    rationale: nullableString(1, 1000),
    created_at: isoTimestampSchema,
    created_by_run_id: agentRunIdSchema.nullable(),
    resolved_at: nullableTimestamp,
    resolved_by_actor_id: actorIdSchema.nullable(),
    resolution_note: nullableString(1, 1000),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.status !== `open`) {
      if (item.resolved_at === null)
        ctx.addIssue({
          code: `custom`,
          path: [`resolved_at`],
          message: `Resolved review items require resolved_at`,
        })
      if (item.resolved_by_actor_id === null)
        ctx.addIssue({
          code: `custom`,
          path: [`resolved_by_actor_id`],
          message: `Resolved review items require resolved_by_actor_id`,
        })
    }
  })

export const agentRunSchema = z
  .object({
    id: agentRunIdSchema,
    wiki_space_id: wikiSpaceIdSchema,
    agent_kind: boundedString(1, 80),
    status: z.enum([`queued`, `running`, `succeeded`, `failed`]),
    input_ref_type: boundedString(1, 80),
    input_ref_id: boundedString(1, 160),
    started_at: isoTimestampSchema,
    finished_at: nullableTimestamp,
    error_message: nullableString(1, 2000),
  })
  .strict()
  .superRefine((run, ctx) => {
    if (
      (run.status === `succeeded` || run.status === `failed`) &&
      run.finished_at === null
    ) {
      ctx.addIssue({
        code: `custom`,
        path: [`finished_at`],
        message: `Terminal agent runs require finished_at`,
      })
    }
    if (run.status === `failed` && run.error_message === null) {
      ctx.addIssue({
        code: `custom`,
        path: [`error_message`],
        message: `Failed agent runs require error_message`,
      })
    }
  })

export type WikiSpaceRow = z.infer<typeof wikiSpaceSchema>
export type ActorRow = z.infer<typeof actorSchema>
export type MembershipRow = z.infer<typeof membershipSchema>
export type ActivityEventRow = z.infer<typeof activityEventSchema>
export type SourceRow = z.infer<typeof sourceSchema>
export type WikiPageRow = z.infer<typeof wikiPageSchema>
export type WikiLinkRow = z.infer<typeof wikiLinkSchema>
export type ReviewItemRow = z.infer<typeof reviewItemSchema>
export type AgentRunRow = z.infer<typeof agentRunSchema>

export const livingWikiStateCollections = {
  wiki_spaces: {
    schema: wikiSpaceSchema,
    type: `wiki_space`,
    primaryKey: `id`,
  },
  actors: { schema: actorSchema, type: `actor`, primaryKey: `id` },
  memberships: {
    schema: membershipSchema,
    type: `membership`,
    primaryKey: `id`,
  },
  activity_events: {
    schema: activityEventSchema,
    type: `activity_event`,
    primaryKey: `id`,
  },
  sources: { schema: sourceSchema, type: `source`, primaryKey: `id` },
  wiki_pages: { schema: wikiPageSchema, type: `wiki_page`, primaryKey: `id` },
  wiki_links: { schema: wikiLinkSchema, type: `wiki_link`, primaryKey: `id` },
  review_items: {
    schema: reviewItemSchema,
    type: `review_item`,
    primaryKey: `id`,
  },
  agent_runs: { schema: agentRunSchema, type: `agent_run`, primaryKey: `id` },
} satisfies Record<string, CollectionDefinition>

export const livingWikiStateSchema = createStateSchema(
  livingWikiStateCollections
)
