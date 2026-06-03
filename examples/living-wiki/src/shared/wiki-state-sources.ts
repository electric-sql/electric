import { z } from 'zod'

import {
  activityEventSchema,
  actorIdSchema,
  sourceSchema,
  wikiSpaceIdSchema,
  type ActivityEventRow,
  type SourceRow,
} from './wiki-state'
import { createActivityEventId, createSourceId } from './wiki-state-ids'

export const SOURCE_TEXT_BODY_MAX_LENGTH = 20_000
export const SOURCE_TEXT_PREVIEW_MAX_LENGTH = 1_000

const titleSchema = z.string().trim().min(1).max(160)
const textBodySchema = z.string().trim().min(1).max(SOURCE_TEXT_BODY_MAX_LENGTH)

const baseSubmitSourceCommandSchema = z.object({
  wikiSpaceId: wikiSpaceIdSchema,
  actorId: actorIdSchema,
  title: titleSchema,
})

export const submitTextSourceCommandSchema =
  baseSubmitSourceCommandSchema.extend({
    kind: z.literal(`text`),
    body: textBodySchema,
  })

export const submitUrlSourceCommandSchema =
  baseSubmitSourceCommandSchema.extend({
    kind: z.literal(`url`),
    url: z.string().trim().url(),
  })

export const submitSourceCommandSchema = z.discriminatedUnion(`kind`, [
  submitTextSourceCommandSchema,
  submitUrlSourceCommandSchema,
])

export type SubmitSourceCommand = z.input<typeof submitSourceCommandSchema>
export type ParsedSubmitSourceCommand = z.output<
  typeof submitSourceCommandSchema
>

export type BuildSourceSubmissionRowsOptions = {
  now?: () => Date
  sourceSeed?: string
  eventSeed?: string
}

export type SourceSubmissionRows = {
  source: SourceRow
  activityEvent: ActivityEventRow
}

export function buildSourceSubmissionRows(
  command: SubmitSourceCommand,
  options: BuildSourceSubmissionRowsOptions = {}
): SourceSubmissionRows {
  const parsed = submitSourceCommandSchema.parse(command)
  const submittedAt = (options.now?.() ?? new Date()).toISOString()
  const sourceId = createSourceId(options.sourceSeed)

  const source = sourceSchema.parse({
    id: sourceId,
    wiki_space_id: parsed.wikiSpaceId,
    kind: parsed.kind,
    status: `submitted`,
    title: parsed.title,
    url: parsed.kind === `url` ? parsed.url : null,
    text_preview:
      parsed.kind === `text` ? createBoundedTextPreview(parsed.body) : null,
    submitted_by_actor_id: parsed.actorId,
    submitted_at: submittedAt,
    published_at: null,
    metadata:
      parsed.kind === `text`
        ? { body_length: parsed.body.length }
        : { url_host: new URL(parsed.url).host },
  })

  const activityEvent = activityEventSchema.parse({
    id: createActivityEventId(options.eventSeed),
    wiki_space_id: parsed.wikiSpaceId,
    occurred_at: submittedAt,
    actor_id: parsed.actorId,
    actor_kind: `human`,
    event_type: `source_submitted`,
    summary: `${parsed.title} submitted as a ${parsed.kind} source`,
    subject_type: `source`,
    subject_id: sourceId,
    visibility: `ambient`,
    metadata: { source_kind: parsed.kind },
  })

  return { source, activityEvent }
}

function createBoundedTextPreview(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > SOURCE_TEXT_PREVIEW_MAX_LENGTH
    ? trimmed.slice(0, SOURCE_TEXT_PREVIEW_MAX_LENGTH)
    : trimmed
}
