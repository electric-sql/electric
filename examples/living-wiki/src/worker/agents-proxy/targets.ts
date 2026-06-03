import {
  agentsEntityTargetInputSchema,
  agentsObserveTargetInputSchema,
  type AgentEntityKind,
  type AgentsEntityTargetInput,
} from '../../shared/agents-proxy'

export type EntityMainStreamViaMetadataTarget = {
  kind: `entity-main-stream-via-metadata`
  entityType: AgentEntityKind
  instanceId: string
  metadataPath: string
}

export type EntitiesObserveViaEnsureTarget = {
  kind: `entities-observe-via-ensure`
  ensurePath: `/_electric/observations/entities/ensure-stream`
  ensureBody: { tags: EntitiesObserveTags }
}

export type SharedStateObserveTarget = {
  kind: `shared-state-observe`
  /** Deterministic Living Wiki proxy-boundary placeholder until resolved from WikiSpace metadata. */
  sharedStateId: string
  streamPath: string
}

export type AgentsObserveTarget =
  | EntitiesObserveViaEnsureTarget
  | SharedStateObserveTarget

export type AgentsProxyTarget =
  | EntityMainStreamViaMetadataTarget
  | AgentsObserveTarget

export type EntitiesObserveTags = {
  wiki_space_id: string
}

const ENTITY_METADATA_PREFIX = `/_electric/entities`
export const ENTITIES_OBSERVE_ENSURE_PATH =
  `/_electric/observations/entities/ensure-stream` as const
const SHARED_STATE_PREFIX = `/_electric/shared-state`
const SHARED_STATE_ID_PREFIX = `living-wiki:`

export function resolveEntityMainStreamTarget(
  input: unknown
): EntityMainStreamViaMetadataTarget {
  const parsed = agentsEntityTargetInputSchema.parse(input)
  const entityType = resolveEntityType(parsed.entityKind)
  const instanceId = resolveEntityInstanceId(parsed)

  return {
    kind: `entity-main-stream-via-metadata`,
    entityType,
    instanceId,
    metadataPath: `${ENTITY_METADATA_PREFIX}/${encodePathSegment(entityType)}/${encodePathSegment(instanceId)}`,
  }
}

export function resolveObserveTarget(input: unknown): AgentsObserveTarget {
  const parsed = agentsObserveTargetInputSchema.parse(input)

  switch (parsed.observeKind) {
    case `entities`:
      return resolveEntitiesObserveTarget(parsed)
    case `shared-state`:
      return resolveSharedStateObserveTarget(parsed)
  }
}

export function resolveEntitiesObserveTarget(
  input: unknown
): EntitiesObserveViaEnsureTarget {
  const parsed = agentsObserveTargetInputSchema.parse(input)
  if (parsed.observeKind !== `entities`) {
    throw new Error(`Expected entities observe kind`)
  }

  return {
    kind: `entities-observe-via-ensure`,
    ensurePath: ENTITIES_OBSERVE_ENSURE_PATH,
    ensureBody: { tags: deriveEntitiesObserveTags(parsed.wikiSpaceId) },
  }
}

export function resolveSharedStateObserveTarget(
  input: unknown
): SharedStateObserveTarget {
  const parsed = agentsObserveTargetInputSchema.parse(input)
  if (parsed.observeKind !== `shared-state`) {
    throw new Error(`Expected shared-state observe kind`)
  }

  const sharedStateId = deriveSharedStateId(parsed.wikiSpaceId)

  return {
    kind: `shared-state-observe`,
    sharedStateId,
    streamPath: `${SHARED_STATE_PREFIX}/${encodePathSegment(sharedStateId)}`,
  }
}

export function deriveEntitiesObserveTags(
  wikiSpaceId: string
): EntitiesObserveTags {
  return { wiki_space_id: wikiSpaceId }
}

export function deriveSharedStateId(wikiSpaceId: string): string {
  return `${SHARED_STATE_ID_PREFIX}${wikiSpaceId}`
}

function resolveEntityType(entityKind: AgentEntityKind): AgentEntityKind {
  switch (entityKind) {
    case `wiki-space`:
      return `wiki-space`
  }
}

function resolveEntityInstanceId(input: AgentsEntityTargetInput): string {
  return input.entityId
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment)
}
