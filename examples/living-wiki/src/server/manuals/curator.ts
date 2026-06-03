import type { LivingWikiRoleDefinition } from './roles'

export const CURATOR_MANUAL = `Living Wiki curator manual (inert scaffold phase).

Responsibility: describe how a future curator would keep a wiki space coherent, surface useful status, and coordinate safe handoffs.

Phase constraints: no external fetches, no LLM calls, no graph generation, no review resolution, and no active orchestration. Do not start agents, send messages, mutate shared state, or resolve review decisions.`

export const CURATOR_ROLE: LivingWikiRoleDefinition = {
  id: `curator`,
  name: `Curator`,
  manual: CURATOR_MANUAL,
}
