import {
  getCronSourceRef,
  getCronStreamPath,
  resolveCronScheduleSpec,
} from './cron-utils'
import { z } from 'zod'
import {
  assertTags,
  entitiesObservationCollections,
  getEntitiesStreamPath,
  normalizeTags,
  hashString,
  sourceRefForTags,
} from './tags'
import { getSharedStateStreamPath } from './runtime-server-client'
import type {
  ManifestSourceEntry,
  ObservationSource,
  SharedStateSchemaMap,
} from './types'
import type { EntityTags } from './tags'
import type { CollectionDefinition } from '@durable-streams/state'

export interface PgSyncOptions {
  table: string
  columns?: string[]
  where?: string
  params?: string[] | Record<string, string>
  replica?: `default` | `full`
}

export interface PgSyncObservationSource extends ObservationSource {
  readonly sourceType: `pgSync`
  readonly options: PgSyncOptions
  readonly streamUrl: string
  readonly schema: typeof pgSyncObservationCollections
}

export const pgSyncObservationCollections = {
  changes: {
    type: `pg_sync_change`,
    primaryKey: `key`,
  },
}

export function getPgSyncStreamPath(sourceRef: string): string {
  return `/_electric/pg-sync/${sourceRef}`
}

type CanonicalPgSyncConfig = {
  table: string
  columns?: string[]
  where?: string
  params?: string[] | Record<string, string>
  replica: `default` | `full`
}

function normalizePgSyncParams(
  params: PgSyncOptions[`params`]
): PgSyncOptions[`params`] | undefined {
  if (params === undefined) return undefined
  if (Array.isArray(params)) return [...params]
  return Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((sorted, key) => {
      sorted[key] = params[key]!
      return sorted
    }, {})
}

function canonicalPgSyncConfig(options: PgSyncOptions): CanonicalPgSyncConfig {
  return {
    table: options.table,
    ...(options.columns !== undefined ? { columns: [...options.columns] } : {}),
    ...(options.where !== undefined ? { where: options.where } : {}),
    ...(options.params !== undefined
      ? { params: normalizePgSyncParams(options.params) }
      : {}),
    replica: options.replica ?? `default`,
  }
}

export function sourceRefForPgSync(options: PgSyncOptions): string {
  return hashString(JSON.stringify(canonicalPgSyncConfig(options)))
}

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

export interface WebhookObservationSource extends ObservationSource {
  readonly sourceType: `webhook`
  readonly endpointKey: string
  readonly bucket?: string
  readonly streamUrl: string
  readonly schema: typeof webhookObservationCollections
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

export interface WebhookOptions {
  bucket?: string
}

export const webhookEventRowSchema = z
  .object({
    key: z.string(),
    body: z.unknown(),
    event_type: z.string().nullable(),
    endpoint_key: z.string(),
    bucket: z.string().nullable(),
    stream_path: z.string(),
    headers: z.record(z.string(), z.string()).default({}),
    received_at: z.string(),
    request: z
      .object({
        method: z.string(),
        content_type: z.string(),
        size_bytes: z.number(),
        query: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
        cf_ray: z.string().nullable().optional(),
        ip: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough()

export type WebhookEventRow = z.infer<typeof webhookEventRowSchema>

export const webhookObservationCollections = {
  events: {
    schema: webhookEventRowSchema,
    type: `webhook_event`,
    primaryKey: `key`,
  },
} satisfies Record<string, CollectionDefinition>

export function getWebhookStreamPath(
  endpointKey: string,
  bucket?: string
): string {
  assertWebhookEndpointKey(endpointKey)
  const normalizedBucket = bucket ? normalizeWebhookBucket(bucket) : null
  return normalizedBucket
    ? `/_webhooks/${endpointKey}/${normalizedBucket}`
    : `/_webhooks/${endpointKey}`
}

export function webhook(
  endpointKey: string,
  opts: WebhookOptions = {}
): WebhookObservationSource {
  const normalizedBucket = opts.bucket
    ? normalizeWebhookBucket(opts.bucket)
    : undefined
  const streamUrl = getWebhookStreamPath(endpointKey, opts.bucket)
  const sourceRef = normalizedBucket
    ? `${endpointKey}/${normalizedBucket}`
    : endpointKey
  return {
    sourceType: `webhook`,
    sourceRef,
    endpointKey,
    ...(normalizedBucket ? { bucket: normalizedBucket } : {}),
    streamUrl,
    schema: webhookObservationCollections,
    ensureStream: { contentType: `application/json` },
    wake() {
      return {
        sourceUrl: streamUrl,
        condition: {
          on: `change` as const,
          collections: [`webhook_event`],
          ops: [`insert`],
        },
      }
    },
    toManifestEntry(): ManifestSourceEntry {
      return {
        key: manifestSourceKey(`webhook`, sourceRef),
        kind: `source`,
        sourceType: `webhook`,
        sourceRef,
        config: {
          endpointKey,
          streamUrl,
          ...(normalizedBucket ? { bucket: normalizedBucket } : {}),
        },
      }
    },
  }
}

export interface DbObservationSource<
  TSchema extends SharedStateSchemaMap = SharedStateSchemaMap,
> extends ObservationSource {
  readonly sourceType: `db`
  readonly dbId: string
  readonly schema: TSchema
  readonly streamUrl: string
}

export function db<const TSchema extends SharedStateSchemaMap>(
  id: string,
  dbSchema: TSchema
): DbObservationSource<TSchema> {
  const streamPath = getSharedStateStreamPath(id)
  return {
    sourceType: `db`,
    sourceRef: id,
    streamUrl: streamPath,
    schema: dbSchema,
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
            Object.entries(dbSchema).map(([name, def]) => [
              name,
              { type: def.type, primaryKey: def.primaryKey },
            ])
          ),
        },
      }
    },
  }
}

export function pgSync(options: PgSyncOptions): PgSyncObservationSource {
  const config = canonicalPgSyncConfig(options)
  const sourceRef = sourceRefForPgSync(config)
  const streamUrl = getPgSyncStreamPath(sourceRef)
  return {
    sourceType: `pgSync`,
    sourceRef,
    streamUrl,
    schema: pgSyncObservationCollections,
    options: config,
    wake() {
      return {
        sourceUrl: streamUrl,
        condition: { on: `change`, collections: [`pg_sync_change`] },
      }
    },
    toManifestEntry(): ManifestSourceEntry {
      return {
        key: manifestSourceKey(`pgSync`, sourceRef),
        kind: `source`,
        sourceType: `pgSync`,
        sourceRef,
        config,
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

function assertWebhookEndpointKey(endpointKey: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(endpointKey)) {
    throw new Error(
      `[agent-runtime] webhook endpointKey must be a URL-safe identifier`
    )
  }
}

function normalizeWebhookBucket(bucket: string): string {
  const trimmed = bucket.trim().replace(/^\/+|\/+$/g, ``)
  const segments = trimmed.split(`/`)
  if (
    !trimmed ||
    segments.some(
      (segment) =>
        segment === `` ||
        segment === `.` ||
        segment === `..` ||
        !/^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/.test(segment)
    )
  ) {
    throw new Error(
      `[agent-runtime] webhook bucket must use non-empty URL-safe path segments`
    )
  }
  return segments.join(`/`)
}
