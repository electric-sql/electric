import { getWebhookStreamPath } from './observation-sources'
import type { WebhookEventRow } from './observation-sources'

export type EventSourceType = `webhook`
export type EventSourceStatus = `active` | `disabled` | `revoked`

export type SubscriptionLifetime =
  | { kind: `until_entity_stopped` }
  | { kind: `expires_at`; at: string }
  | { kind: `manual` }

export type EventSourceFilterCondition = {
  collections?: Array<string>
  ops?: Array<`insert` | `update` | `delete`>
  where?: {
    language: `cel`
    expression: string
  }
}

export type EventSourceFilter = {
  key: string
  label: string
  description?: string
  condition?: EventSourceFilterCondition
}

export type EventSourceBucket = {
  key: string
  label: string
  description?: string
  pathTemplate: string
  paramsSchema: Record<string, unknown>
  eventTypes?: Array<string>
  filters?: Array<EventSourceFilter>
}

export type EventSourceContract = {
  serviceId?: string
  sourceKey: string
  sourceType: EventSourceType
  endpointKey: string
  status: EventSourceStatus
  label: string
  description?: string
  agentVisible: boolean
  buckets: Array<EventSourceBucket>
  updatedAt?: string
  revision: number
}

export type EventSourceSubscriptionInput = {
  id?: string
  sourceKey: string
  bucketKey?: string
  params?: Record<string, unknown>
  filterKey?: string
  lifetime?: SubscriptionLifetime
  reason?: string
}

export type EventSourceSubscription = {
  id: string
  entityUrl: string
  sourceKey: string
  bucketKey?: string
  params: Record<string, unknown>
  filterKey?: string
  filterApplied: boolean
  contractRevision: number
  sourceUrl: string
  sourceType: EventSourceType
  manifestKey: string
  lifetime: SubscriptionLifetime
  reason?: string
  createdBy: `tool` | `handler` | `user` | `system`
  createdAt: string
}

export type ResolvedEventSourceSubscription = {
  subscription: EventSourceSubscription
  contract: EventSourceContract
  bucket?: EventSourceBucket
  bucketPath?: string
}

export type EventSourceWakeChange = {
  collection: string
  kind: `insert` | `update` | `delete`
  key: string
}

export type EventSourceWakeInfo = {
  sourceUrl: string
  sourceType: EventSourceType
  endpointKey: string
  sourceKey: string
  subscriptionId: string
  bucket?: string
  bucketKey?: string
  params: Record<string, unknown>
  filterKey?: string
  reason?: string
  changes: Array<EventSourceWakeChange>
}

export type HydratedEventSourceWake = {
  type: `event_source_wake`
  source: string
  sourceType: EventSourceType
  endpointKey: string
  sourceKey: string
  subscription: {
    id: string
    bucketKey?: string
    params: Record<string, unknown>
    filterKey?: string
    reason?: string
  }
  bucket: string | null
  changes: Array<EventSourceWakeChange>
  events: Array<WebhookEventRow>
  missingEventKeys?: Array<string>
}

const DEFAULT_LIFETIME: SubscriptionLifetime = { kind: `until_entity_stopped` }

export function defaultEventSourceSubscriptionLifetime(): SubscriptionLifetime {
  return { ...DEFAULT_LIFETIME }
}

export function eventSourceSubscriptionManifestKey(id: string): string {
  return `event-source:${id}`
}

export function buildEventSourceSubscriptionId(input: {
  sourceKey: string
  bucketKey?: string
  params?: Record<string, unknown>
  filterKey?: string
}): string {
  const prefix = normalizeIdentifierPart(
    [input.sourceKey, input.bucketKey ?? `root`, input.filterKey]
      .filter(Boolean)
      .join(`-`)
  )
  return `${prefix}-${hashString(stableJson(input))}`
}

export function renderEventSourceBucketPath(
  bucket: EventSourceBucket,
  params: Record<string, unknown> = {}
): string {
  const rendered = bucket.pathTemplate.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, name: string) => {
      if (!(name in params)) {
        throw new Error(`Missing bucket parameter: ${name}`)
      }
      return encodeURIComponent(stringifyBucketParam(params[name], name))
    }
  )

  if (rendered.includes(`//`) || rendered.startsWith(`/`)) {
    throw new Error(`Invalid bucket path template: ${bucket.pathTemplate}`)
  }

  if (rendered.trim().length === 0) {
    throw new Error(`Bucket path template rendered an empty path`)
  }

  return rendered
}

export function resolveEventSourceSubscription(input: {
  contract: EventSourceContract
  entityUrl: string
  request: EventSourceSubscriptionInput
  createdBy?: EventSourceSubscription[`createdBy`]
  createdAt?: string
}): ResolvedEventSourceSubscription {
  const { contract, request } = input
  if (!contract.agentVisible || contract.status !== `active`) {
    throw new Error(`Event source "${contract.sourceKey}" is not active`)
  }
  if (request.sourceKey !== contract.sourceKey) {
    throw new Error(
      `Event source key mismatch: expected ${contract.sourceKey}, got ${request.sourceKey}`
    )
  }

  const params = request.params ?? {}
  const bucket = request.bucketKey
    ? contract.buckets.find((candidate) => candidate.key === request.bucketKey)
    : undefined
  if (request.bucketKey && !bucket) {
    throw new Error(
      `Unknown bucket "${request.bucketKey}" for event source "${contract.sourceKey}"`
    )
  }

  if (
    request.filterKey &&
    !bucket?.filters?.some((f) => f.key === request.filterKey)
  ) {
    throw new Error(
      `Unknown filter "${request.filterKey}" for event source "${contract.sourceKey}"`
    )
  }

  const bucketPath = bucket
    ? renderEventSourceBucketPath(bucket, params)
    : undefined
  const sourceUrl = getWebhookStreamPath(contract.endpointKey, bucketPath)
  const id =
    request.id ??
    buildEventSourceSubscriptionId({
      sourceKey: request.sourceKey,
      bucketKey: request.bucketKey,
      params,
      filterKey: request.filterKey,
    })
  const manifestKey = eventSourceSubscriptionManifestKey(id)

  return {
    contract,
    ...(bucket ? { bucket } : {}),
    ...(bucketPath ? { bucketPath } : {}),
    subscription: {
      id,
      entityUrl: input.entityUrl,
      sourceKey: contract.sourceKey,
      ...(request.bucketKey ? { bucketKey: request.bucketKey } : {}),
      params,
      ...(request.filterKey ? { filterKey: request.filterKey } : {}),
      filterApplied: false,
      contractRevision: contract.revision,
      sourceUrl,
      sourceType: contract.sourceType,
      manifestKey,
      lifetime: request.lifetime ?? defaultEventSourceSubscriptionLifetime(),
      ...(request.reason ? { reason: request.reason } : {}),
      createdBy: input.createdBy ?? `tool`,
      createdAt: input.createdAt ?? new Date().toISOString(),
    },
  }
}

export function buildEventSourceManifestEntry(
  resolved: ResolvedEventSourceSubscription
): Record<string, unknown> {
  const { subscription, contract, bucketPath } = resolved
  return {
    key: subscription.manifestKey,
    kind: `source`,
    sourceType: `webhook`,
    sourceRef: bucketPath
      ? `${contract.endpointKey}/${bucketPath}`
      : contract.endpointKey,
    config: {
      endpointKey: contract.endpointKey,
      streamUrl: subscription.sourceUrl,
      ...(bucketPath ? { bucket: bucketPath } : {}),
      eventSource: {
        id: subscription.id,
        sourceKey: subscription.sourceKey,
        ...(subscription.bucketKey
          ? { bucketKey: subscription.bucketKey }
          : {}),
        params: subscription.params,
        ...(subscription.filterKey
          ? { filterKey: subscription.filterKey }
          : {}),
        filterApplied: subscription.filterApplied,
        contractRevision: subscription.contractRevision,
        lifetime: subscription.lifetime,
        ...(subscription.reason ? { reason: subscription.reason } : {}),
        createdBy: subscription.createdBy,
        createdAt: subscription.createdAt,
      },
    },
    wake: {
      on: `change`,
      collections: [`webhook_event`],
      ops: [`insert`],
    },
  }
}

export function eventSourceWakeInfoFromManifests(input: {
  wakeEvent: {
    type?: unknown
    source?: unknown
    payload?: unknown
  }
  manifests: Array<unknown>
}): EventSourceWakeInfo | null {
  const wakePayload = asRecord(input.wakeEvent.payload)
  const sourceUrl =
    typeof wakePayload?.source === `string`
      ? wakePayload.source
      : typeof input.wakeEvent.source === `string`
        ? input.wakeEvent.source
        : null
  if (input.wakeEvent.type !== `wake` || !sourceUrl) return null

  const changes = normalizeEventSourceWakeChanges(wakePayload?.changes)
  if (!changes.some((change) => change.collection === `webhook_event`)) {
    return null
  }

  for (const candidate of input.manifests) {
    const manifest = asRecord(candidate)
    if (!manifest) continue
    if (manifest.kind !== `source` || manifest.sourceType !== `webhook`) {
      continue
    }

    const config = asRecord(manifest.config)
    const eventSource = asRecord(config?.eventSource)
    if (!config || !eventSource) continue
    if (config.streamUrl !== sourceUrl) continue

    const endpointKey = stringFrom(config.endpointKey)
    const sourceKey = stringFrom(eventSource.sourceKey)
    const subscriptionId = stringFrom(eventSource.id)
    if (!endpointKey || !sourceKey || !subscriptionId) continue

    return {
      sourceUrl,
      sourceType: `webhook`,
      endpointKey,
      sourceKey,
      subscriptionId,
      ...(typeof config.bucket === `string` ? { bucket: config.bucket } : {}),
      ...(typeof eventSource.bucketKey === `string`
        ? { bucketKey: eventSource.bucketKey }
        : {}),
      params: asRecord(eventSource.params) ?? {},
      ...(typeof eventSource.filterKey === `string`
        ? { filterKey: eventSource.filterKey }
        : {}),
      ...(typeof eventSource.reason === `string`
        ? { reason: eventSource.reason }
        : {}),
      changes,
    }
  }

  return null
}

export function buildHydratedEventSourceWake(
  info: EventSourceWakeInfo,
  events: Array<WebhookEventRow>
): HydratedEventSourceWake {
  const eventKeys = new Set(
    info.changes
      .filter((change) => change.collection === `webhook_event`)
      .map((change) => change.key)
      .filter(Boolean)
  )
  const matchedEvents =
    eventKeys.size === 0
      ? []
      : events.filter((event) => eventKeys.has(event.key))
  const matchedKeys = new Set(matchedEvents.map((event) => event.key))
  const missingEventKeys = [...eventKeys].filter((key) => !matchedKeys.has(key))

  return {
    type: `event_source_wake`,
    source: info.sourceUrl,
    sourceType: info.sourceType,
    endpointKey: info.endpointKey,
    sourceKey: info.sourceKey,
    subscription: {
      id: info.subscriptionId,
      ...(info.bucketKey ? { bucketKey: info.bucketKey } : {}),
      params: info.params,
      ...(info.filterKey ? { filterKey: info.filterKey } : {}),
      ...(info.reason ? { reason: info.reason } : {}),
    },
    bucket: info.bucket ?? null,
    changes: info.changes,
    events: matchedEvents,
    ...(missingEventKeys.length > 0 ? { missingEventKeys } : {}),
  }
}

function stringifyBucketParam(value: unknown, name: string): string {
  if (
    typeof value !== `string` &&
    typeof value !== `number` &&
    typeof value !== `boolean`
  ) {
    throw new Error(`Bucket parameter "${name}" must be a scalar value`)
  }
  const stringValue = String(value)
  if (stringValue.length === 0) {
    throw new Error(`Bucket parameter "${name}" must not be empty`)
  }
  return stringValue
}

function normalizeIdentifierPart(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
  return normalized.length > 0 ? normalized.slice(0, 80) : `event-source`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === `object` && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringFrom(value: unknown): string | null {
  return typeof value === `string` && value.length > 0 ? value : null
}

function normalizeEventSourceWakeChanges(
  value: unknown
): Array<EventSourceWakeChange> {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): Array<EventSourceWakeChange> => {
    const record = asRecord(entry)
    if (!record) return []
    const collection = stringFrom(record.collection)
    const key = stringFrom(record.key)
    const kind =
      record.kind === `delete`
        ? `delete`
        : record.kind === `update`
          ? `update`
          : record.kind === `insert`
            ? `insert`
            : null
    if (!collection || !key || !kind) return []
    return [{ collection, kind, key }]
  })
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(`,`)}]`
  }
  if (value && typeof value === `object`) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(`,`)}}`
  }
  return JSON.stringify(value)
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
