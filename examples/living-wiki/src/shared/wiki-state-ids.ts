export const WIKI_SPACE_ID_PREFIX = `wiki_` as const
export const ACTOR_ID_PREFIX = `actor_` as const
export const MEMBERSHIP_ID_PREFIX = `membership_` as const
export const SOURCE_ID_PREFIX = `source_` as const
export const WIKI_PAGE_ID_PREFIX = `page_` as const
export const WIKI_LINK_ID_PREFIX = `link_` as const
export const REVIEW_ITEM_ID_PREFIX = `review_` as const
export const ACTIVITY_EVENT_ID_PREFIX = `event_` as const
export const AGENT_RUN_ID_PREFIX = `agent_run_` as const

const GENERATED_SEED = `generated`
const SHARED_STATE_ID_PREFIX = `living-wiki:` as const
const wikiSpaceIdPattern = /^wiki_[a-z0-9_-]+$/
const generatedIdPattern = /^[a-z0-9_-]+$/

let fallbackIdCounter = 0

export function createWikiSpaceId(seed?: string): string {
  return createPrefixedId(WIKI_SPACE_ID_PREFIX, seed)
}

export function createActorId(seed?: string): string {
  return createPrefixedId(ACTOR_ID_PREFIX, seed)
}

export function createMembershipId(
  wikiSpaceId: string,
  actorId: string
): string {
  return createPrefixedId(MEMBERSHIP_ID_PREFIX, `${wikiSpaceId}_${actorId}`)
}

export function createSourceId(seed?: string): string {
  return createPrefixedId(SOURCE_ID_PREFIX, seed)
}

export function createWikiPageId(seedOrSlug: string): string {
  return createPrefixedId(WIKI_PAGE_ID_PREFIX, seedOrSlug)
}

export function createWikiLinkId(
  fromPageId: string,
  toPageId: string,
  labelOrSeed?: string
): string {
  return createPrefixedId(
    WIKI_LINK_ID_PREFIX,
    [fromPageId, toPageId, labelOrSeed].filter(Boolean).join(`_`)
  )
}

export function createReviewItemId(seed?: string): string {
  return createPrefixedId(REVIEW_ITEM_ID_PREFIX, seed)
}

export function createActivityEventId(seed?: string): string {
  return createPrefixedId(ACTIVITY_EVENT_ID_PREFIX, seed)
}

export function createAgentRunId(seed?: string): string {
  return createPrefixedId(AGENT_RUN_ID_PREFIX, seed)
}

export function nowIsoTimestamp(clock: () => Date = () => new Date()): string {
  return clock().toISOString()
}

export function deriveLivingWikiSharedStateId(wikiSpaceId: string): string {
  if (
    !wikiSpaceIdPattern.test(wikiSpaceId) ||
    wikiSpaceId === WIKI_SPACE_ID_PREFIX
  ) {
    throw new Error(`Expected a Living Wiki space id like wiki_<id>`)
  }

  return `${SHARED_STATE_ID_PREFIX}${wikiSpaceId}`
}

function createPrefixedId(prefix: string, seed?: string): string {
  const suffix = seed === undefined ? createGeneratedSeed() : sanitizeSeed(seed)
  return `${prefix}${suffix}`
}

function sanitizeSeed(seed: string): string {
  const sanitized = seed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^-+|-+$/g, ``)

  return sanitized.length > 0 ? sanitized : GENERATED_SEED
}

function createGeneratedSeed(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) {
    return sanitizeSeed(uuid)
  }

  fallbackIdCounter += 1
  const timePart = Date.now().toString(36)
  const counterPart = fallbackIdCounter.toString(36)
  const generated = `${timePart}-${counterPart}`

  return generatedIdPattern.test(generated) ? generated : GENERATED_SEED
}
