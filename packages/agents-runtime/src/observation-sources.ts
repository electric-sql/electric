import {
  getCronSourceRef,
  getCronStreamPath,
  resolveCronScheduleSpec,
} from './cron-utils'
import {
  assertTags,
  entitiesObservationCollections,
  getEntitiesStreamPath,
  normalizeTags,
  sourceRefForTags,
} from './tags'
import { getSharedStateStreamPath } from './runtime-server-client'
import type {
  ManifestSourceEntry,
  ObservationSource,
  SharedStateSchemaMap,
} from './types'
import type { EntityTags } from './tags'

export interface EntityObservationSource extends ObservationSource {
  readonly sourceType: `entity`
  readonly entityUrl: string
}

export interface CronObservationSource extends ObservationSource {
  readonly sourceType: `cron`
  readonly expression: string
  readonly timezone: string
}

export interface EntitiesQuery {
  tags: EntityTags
  where?: string
  select?: Array<string>
}

export interface EntitiesObservationSource extends ObservationSource {
  readonly sourceType: `entities`
  readonly tags: EntityTags
  readonly query: EntitiesQuery
}

/** @deprecated Use `EntitiesQuery`. */
export interface TaggedQuery {
  match: Record<string, string>
  select?: Array<string>
}

/** @deprecated Use `EntitiesObservationSource`. */
export type TaggedObservationSource = EntitiesObservationSource

export function manifestSourceKey(
  sourceType: string,
  sourceRef: string
): string {
  return `source:${sourceType}:${sourceRef}`
}

export function entity(entityUrl: string): EntityObservationSource {
  return {
    sourceType: `entity`,
    sourceRef: entityUrl,
    entityUrl,
    streamUrl: entityUrl,
    toManifestEntry(): ManifestSourceEntry {
      return {
        key: manifestSourceKey(`entity`, entityUrl),
        kind: `source`,
        sourceType: `entity`,
        sourceRef: entityUrl,
        config: { entityUrl },
      }
    },
  }
}

/** Entity type name for the built-in coding-session entity. */
export const CODING_SESSION_ENTITY_TYPE = `coding-session`

export function codingSessionEntityUrl(sessionId: string): string {
  return `/${CODING_SESSION_ENTITY_TYPE}/${sessionId}`
}

/**
 * Observation source for a coding-session entity (Claude Code / Codex
 * CLI session). Sugar for `entity(codingSessionEntityUrl(sessionId))`
 * so callers don't have to hard-code the type-name prefix.
 */
export function codingSession(sessionId: string): EntityObservationSource {
  return entity(codingSessionEntityUrl(sessionId))
}

export function cron(
  expression: string,
  opts?: { timezone?: string }
): CronObservationSource {
  const spec = resolveCronScheduleSpec(expression, opts?.timezone)
  const sourceRef = getCronSourceRef(spec.expression, spec.timezone)
  const cronStreamUrl = getCronStreamPath(spec.expression, spec.timezone)
  return {
    sourceType: `cron`,
    sourceRef,
    expression: spec.expression,
    timezone: spec.timezone,
    wake() {
      return {
        sourceUrl: cronStreamUrl,
        condition: { on: `change` as const },
      }
    },
    toManifestEntry(): ManifestSourceEntry {
      return {
        key: manifestSourceKey(`cron`, sourceRef),
        kind: `source`,
        sourceType: `cron`,
        sourceRef,
        config: { expression: spec.expression, timezone: spec.timezone },
      }
    },
  }
}

export function entities(query: EntitiesQuery): EntitiesObservationSource {
  const tags = normalizeTags(assertTags(query.tags))
  const sourceRef = sourceRefForTags(tags)
  return {
    sourceType: `entities`,
    sourceRef,
    streamUrl: getEntitiesStreamPath(sourceRef),
    schema: entitiesObservationCollections,
    tags,
    query,
    toManifestEntry(): ManifestSourceEntry {
      return {
        key: manifestSourceKey(`entities`, sourceRef),
        kind: `source`,
        sourceType: `entities`,
        sourceRef,
        config: {
          tags,
          ...(query.where ? { where: query.where } : {}),
          ...(query.select ? { select: query.select } : {}),
        },
      }
    },
  }
}

export interface DbObservationSource extends ObservationSource {
  readonly sourceType: `db`
  readonly dbId: string
  readonly schema: SharedStateSchemaMap
  readonly streamUrl: string
}

export function db(
  id: string,
  schema: SharedStateSchemaMap
): DbObservationSource {
  const streamPath = getSharedStateStreamPath(id)
  return {
    sourceType: `db`,
    sourceRef: id,
    streamUrl: streamPath,
    schema,
    dbId: id,
    toManifestEntry(): ManifestSourceEntry {
      return {
        key: manifestSourceKey(`db`, id),
        kind: `source`,
        sourceType: `db`,
        sourceRef: id,
        config: {
          id,
          collections: Object.fromEntries(
            Object.entries(schema).map(([name, def]) => [
              name,
              { type: def.type, primaryKey: def.primaryKey },
            ])
          ),
        },
      }
    },
  }
}

export function tagged(query: TaggedQuery): TaggedObservationSource {
  return entities({
    tags: query.match,
    select: query.select,
  })
}
