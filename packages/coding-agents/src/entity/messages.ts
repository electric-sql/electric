import { z } from 'zod'

export const promptMessageSchema = z.object({
  text: z.string(),
})
export const pinMessageSchema = z.object({}).strict()
export const releaseMessageSchema = z.object({}).strict()
export const stopMessageSchema = z.object({}).strict()
export const destroyMessageSchema = z.object({}).strict()
export const idleEvictionFiredMessageSchema = z.object({}).passthrough()

export type PromptMessage = z.infer<typeof promptMessageSchema>
