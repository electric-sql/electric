import { z } from 'zod'

export const promptMessageSchema = z.object({
  text: z.string(),
})
export const pinMessageSchema = z.object({}).strict()
export const releaseMessageSchema = z.object({}).strict()
export const stopMessageSchema = z.object({}).strict()
export const destroyMessageSchema = z.object({}).strict()
export const idleEvictionFiredMessageSchema = z.object({}).passthrough()
// No-op nudge that exists solely to give the runtime a "fresh wake input"
// so the handler's first-wake init block runs. Used by the import CLI
// after PUT so spawn args are actually applied. The handler's dispatch
// just returns — first-wake init is keyed on `!sessionMeta`, not on this
// message type, so any subsequent invocation also no-ops.
export const initNudgeMessageSchema = z.object({}).passthrough()

export type PromptMessage = z.infer<typeof promptMessageSchema>

export const convertTargetMessageSchema = z.object({
  to: z.enum([`sandbox`, `host`]),
})
export type ConvertTargetMessage = z.infer<typeof convertTargetMessageSchema>

export const convertKindMessageSchema = z.object({
  kind: z.enum([`claude`, `codex`]),
  model: z.string().optional(),
})
export type ConvertKindMessage = z.infer<typeof convertKindMessageSchema>
