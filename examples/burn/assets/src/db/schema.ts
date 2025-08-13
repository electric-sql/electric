import * as z from 'zod/v4'

const timestamps = {
  inserted_at: z.date().optional(),
  updated_at: z.date().optional(),
}

export const authSchema = z.object({
  key: z.literal('current'),
  user_id: z.uuid(),
})

export const userSchema = z.object({
  id: z.uuid(),
  type: z.enum(['human', 'agent']),
  name: z.string(),
  avatar_url: z.string().url(),

  ...timestamps,
})

export const threadSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['started', 'cancelled', 'completed']),

  ...timestamps,
})

export const membershipSchema = z.object({
  id: z.uuid(),
  thread_id: z.uuid(),
  user_id: z.uuid(),
  role: z.enum(['member', 'owner', 'producer', 'comedian']),

  ...timestamps,
})

export const eventSchema = z.object({
  id: z.uuid(),
  thread_id: z.uuid(),
  user_id: z.uuid().optional(),

  type: z.enum(['system', 'text', 'tool_use', 'tool_result']),
  data: z.record(z.string(), z.any()),

  ...timestamps,
})

export const factSchema = z.object({
  id: z.uuid(),
  thread_id: z.uuid(),
  source_event_id: z.uuid(),
  tool_use_event_id: z.uuid(),
  subject_id: z.uuid(),

  predicate: z.string(),
  object: z.string(),
  category: z.string(),
  confidence: z.number(),
  disputed: z.boolean(),

  ...timestamps,
})

export type Thread = z.infer<typeof threadSchema>
export type Membership = z.infer<typeof membershipSchema>
export type User = z.infer<typeof userSchema>
export type Auth = z.infer<typeof authSchema>
export type Event = z.infer<typeof eventSchema>
export type Fact = z.infer<typeof factSchema>
