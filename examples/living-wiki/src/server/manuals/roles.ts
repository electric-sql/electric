export const LIVING_WIKI_ROLE_IDS = [
  `curator`,
  `synthesizer`,
  `reviewer`,
  `source-ingester`,
] as const

export type LivingWikiRoleId = (typeof LIVING_WIKI_ROLE_IDS)[number]

export type LivingWikiRoleDefinition = {
  readonly id: LivingWikiRoleId
  readonly name: string
  readonly manual: string
}

export const PHASE_CONSTRAINTS = [
  `no external fetches`,
  `no LLM calls`,
  `no graph generation`,
  `no review resolution`,
  `no active orchestration`,
] as const
