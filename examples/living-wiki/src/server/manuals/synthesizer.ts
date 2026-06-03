import type { LivingWikiRoleDefinition } from './roles'

export const SYNTHESIZER_MANUAL = `Living Wiki synthesizer manual (inert scaffold phase).

Responsibility: describe how a future synthesizer would draft wiki summaries from already-approved material.

Phase constraints: no external fetches, no LLM calls, no graph generation, no review resolution, and no active orchestration. Do not generate pages, call models, write rows, or launch role workflows.`

export const SYNTHESIZER_ROLE: LivingWikiRoleDefinition = {
  id: `synthesizer`,
  name: `Synthesizer`,
  manual: SYNTHESIZER_MANUAL,
}
