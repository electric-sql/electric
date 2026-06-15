import { COMMENTS_CONTRACT } from '@electric-ax/agents-runtime/client'

/**
 * Shape of an entity type's `externally_writable_collections` registration
 * as seen by the client (entity GET response / synced `entity_types` rows).
 */
export type ExternallyWritableCollections =
  | Record<string, { type?: string; contract?: string } | null | undefined>
  | null
  | undefined

/**
 * True when the map advertises the canonical comments contract. Keyed on
 * both the reserved `comments` name and the contract marker so an agent's
 * unrelated writable collection can never light up the comment UI.
 */
export function supportsComments(
  collections: ExternallyWritableCollections
): boolean {
  return collections?.comments?.contract === COMMENTS_CONTRACT
}

type WritableCollectionsLookup = (
  typeName: string
) => ExternallyWritableCollections

let lookup: WritableCollectionsLookup | null = null

/**
 * Registered by `ElectricAgentsProvider` (backed by the synced
 * `entity_types` collection) so non-React callers — the view registry's
 * `isAvailable` gate — can resolve a type's writable collections.
 */
export function registerWritableCollectionsLookup(
  fn: WritableCollectionsLookup | null
): void {
  lookup = fn
}

export function entityTypeSupportsComments(
  typeName: string | null | undefined
): boolean {
  if (!typeName || !lookup) return false
  return supportsComments(lookup(typeName))
}
