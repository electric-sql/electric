import { z } from 'zod'

export const agentEntityKinds = [`wiki-space`] as const
export type AgentEntityKind = (typeof agentEntityKinds)[number]

export const agentObserveKinds = [`entities`, `shared-state`] as const
export type AgentObserveKind = (typeof agentObserveKinds)[number]

const safeIdPattern = /^[A-Za-z0-9_-]+$/

export const safeAgentsProxyIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(safeIdPattern, {
    message: `Expected a URL-safe id containing only letters, numbers, underscores, or hyphens`,
  })
  .refine((value) => !value.toLowerCase().includes(`%2f`), {
    message: `Encoded slashes are not allowed`,
  })
  .refine((value) => !value.includes(`..`), {
    message: `Path traversal segments are not allowed`,
  })

export const agentEntityKindSchema = z.enum(agentEntityKinds)
export const agentObserveKindSchema = z.enum(agentObserveKinds)

export const agentsEntityTargetInputSchema = z
  .object({
    wikiSpaceId: safeAgentsProxyIdSchema,
    entityKind: agentEntityKindSchema,
    entityId: safeAgentsProxyIdSchema,
  })
  .strict()

export type AgentsEntityTargetInput = z.infer<
  typeof agentsEntityTargetInputSchema
>

export const agentsObserveTargetInputSchema = z
  .object({
    wikiSpaceId: safeAgentsProxyIdSchema,
    observeKind: agentObserveKindSchema,
  })
  .strict()

export type AgentsObserveTargetInput = z.infer<
  typeof agentsObserveTargetInputSchema
>
