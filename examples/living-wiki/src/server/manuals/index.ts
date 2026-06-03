export * from './roles'
export * from './curator'
export * from './synthesizer'
export * from './reviewer'
export * from './source-ingester'

import { CURATOR_ROLE } from './curator'
import { REVIEWER_ROLE } from './reviewer'
import type { LivingWikiRoleDefinition } from './roles'
import { SOURCE_INGESTER_ROLE } from './source-ingester'
import { SYNTHESIZER_ROLE } from './synthesizer'

export const LIVING_WIKI_ROLES = [
  CURATOR_ROLE,
  SYNTHESIZER_ROLE,
  REVIEWER_ROLE,
  SOURCE_INGESTER_ROLE,
] as const satisfies readonly LivingWikiRoleDefinition[]
