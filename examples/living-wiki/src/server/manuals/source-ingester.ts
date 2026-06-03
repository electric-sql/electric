import type { LivingWikiRoleDefinition } from './roles'

export const SOURCE_INGESTER_MANUAL = `Living Wiki source-ingester manual (inert scaffold phase).

Responsibility: describe how a future source ingester would validate submitted source metadata before downstream processing.

Phase constraints: no external fetches, no LLM calls, no graph generation, no review resolution, and no active orchestration. Do not fetch URLs, parse remote content, insert source-derived rows, or trigger synthesis.`

export const SOURCE_INGESTER_ROLE: LivingWikiRoleDefinition = {
  id: `source-ingester`,
  name: `Source Ingester`,
  manual: SOURCE_INGESTER_MANUAL,
}
