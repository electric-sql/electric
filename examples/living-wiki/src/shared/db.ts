export type LivingWikiCollectionName =
  | `wiki_spaces`
  | `actors`
  | `activity_events`
  | `sources`
  | `wiki_pages`
  | `wiki_edges`
  | `review_requests`

export const livingWikiCollectionNames: LivingWikiCollectionName[] = [
  `wiki_spaces`,
  `actors`,
  `activity_events`,
  `sources`,
  `wiki_pages`,
  `wiki_edges`,
  `review_requests`,
]

export function assertKnownCollectionName(
  name: string
): asserts name is LivingWikiCollectionName {
  if (!livingWikiCollectionNames.includes(name as LivingWikiCollectionName)) {
    throw new Error(`Unknown Living Wiki collection: ${name}`)
  }
}
