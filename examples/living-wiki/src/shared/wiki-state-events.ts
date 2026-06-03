import { z } from 'zod'

import {
  activityEventSchema,
  actorIdSchema,
  jsonObjectSchema,
  livingWikiStateSchema,
  type ActivityEventRow,
} from './wiki-state'
import { createActivityEventId, nowIsoTimestamp } from './wiki-state-ids'

const boundedString = (min: number, max: number) =>
  z.string().trim().min(min).max(max)

export const createActivityEventInputSchema = z
  .object({
    wiki_space_id: z.string().regex(/^wiki_[a-z0-9_-]+$/),
    actor_id: actorIdSchema,
    actor_kind: z.enum([`human`, `agent`]),
    event_type: boundedString(1, 80),
    summary: boundedString(1, 280),
    subject_type: boundedString(1, 80),
    subject_id: boundedString(1, 160),
    visibility: z.enum([`ambient`, `inspector`, `system`]).default(`ambient`),
    metadata: jsonObjectSchema.default({}),
  })
  .strict()

export type CreateActivityEventInput = z.input<
  typeof createActivityEventInputSchema
>
export type ParsedActivityEventInput = z.output<
  typeof createActivityEventInputSchema
>

export type BuildActivityEventRowOptions = {
  id?: string
  now?: () => Date
}

export function buildActivityEventRow(
  input: CreateActivityEventInput,
  options: BuildActivityEventRowOptions = {}
): ActivityEventRow {
  const parsedInput = createActivityEventInputSchema.parse(input)
  const row = {
    id: options.id ?? createActivityEventId(),
    occurred_at: nowIsoTimestamp(options.now),
    ...parsedInput,
  }

  return activityEventSchema.parse(row)
}

export function buildActivityEventInsertEvent(
  input: CreateActivityEventInput,
  options: BuildActivityEventRowOptions = {}
) {
  const row = buildActivityEventRow(input, options)

  return livingWikiStateSchema.activity_events.insert({ value: row })
}
