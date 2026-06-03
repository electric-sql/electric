import type { LivingWikiRoleDefinition } from './roles'

export const REVIEWER_MANUAL = `Living Wiki reviewer manual (inert scaffold phase).

Responsibility: describe how a future reviewer would inspect proposed wiki changes and explain pending review criteria.

Phase constraints: no external fetches, no LLM calls, no graph generation, no review resolution, and no active orchestration. Do not approve, reject, alter review items, invoke agents, or mutate shared state.`

export const REVIEWER_ROLE: LivingWikiRoleDefinition = {
  id: `reviewer`,
  name: `Reviewer`,
  manual: REVIEWER_MANUAL,
}
