import Ajv from 'ajv'
import { getWebhookStreamPath } from './observation-sources'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { WebhookEventRow } from './observation-sources'

export type WebhookSourceType = `webhook`
export type WebhookSourceStatus = `active` | `disabled` | `revoked`

export type SubscriptionLifetime =
  | { kind: `until_entity_stopped` }
  | { kind: `expires_at`; at: string }
  | { kind: `manual` }

export type WebhookSourceFilterCondition = {
  collections?: Array<string>
  ops?: Array<`insert` | `update` | `delete`>
  where?: {
    language: `cel`
    expression: string
  }
}

export type WebhookSourceFilter = {
  key: string
  label: string
  description?: string
  condition?: WebhookSourceFilterCondition
}

export type WebhookSourceBucket = {
  key: string
  label: string
  description?: string
  pathTemplate: string
  paramsSchema: Record<string, unknown>
  eventTypes?: Array<string>
  filters?: Array<WebhookSourceFilter>
}

export type WebhookSourceContract = {
  serviceId?: string
  webhookKey: string
  sourceType: WebhookSourceType
  endpointKey: string
  status: WebhookSourceStatus
  label: string
  description?: string
  agentVisible: boolean
  buckets: Array<WebhookSourceBucket>
  updatedAt?: string
  revision: number
}

export type WebhookSourceSubscriptionInput = {
  id?: string
  webhookKey: string
  bucketKey?: string
  params?: Record<string, unknown>
  filterKey?: string
  lifetime?: SubscriptionLifetime
  reason?: string
}

export type WebhookSourceSubscription = {
  id: string
  entityUrl: string
  webhookKey: string
  bucketKey?: string
  params: Record<string, unknown>
  filterKey?: string
  filterApplied: boolean
  contractRevision: number
  sourceUrl: string
  sourceType: WebhookSourceType
  manifestKey: string
  lifetime: SubscriptionLifetime
  reason?: string
  createdBy: `tool` | `handler` | `user` | `system`
  createdAt: string
}

export type ResolvedWebhookSourceSubscription = {
  subscription: WebhookSourceSubscription
  contract: WebhookSourceContract
  bucket?: WebhookSourceBucket
  bucketPath?: string
}

export type WebhookSourceWakeChange = {
  collection: string
  kind: `insert` | `update` | `delete`
  key: string
}

export type WebhookSourceWakeInfo = {
  sourceUrl: string
  sourceType: WebhookSourceType
  endpointKey: string
  webhookKey: string
  subscriptionId: string
  bucket?: string
  bucketKey?: string
  params: Record<string, unknown>
  filterKey?: string
  reason?: string
  changes: Array<WebhookSourceWakeChange>
}

export type HydratedWebhookSourceWake = {
  type: `webhook_source_wake`
  source: string
  sourceType: WebhookSourceType
  endpointKey: string
  webhookKey: string
  subscription: {
    id: string
    bucketKey?: string
    params: Record<string, unknown>
    filterKey?: string
    reason?: string
  }
  bucket: string | null
  changes: Array<WebhookSourceWakeChange>
  events: Array<WebhookEventRow>
  missingEventKeys?: Array<string>
}

const DEFAULT_LIFETIME: SubscriptionLifetime = { kind: `until_entity_stopped` }
const paramsSchemaValidator = new Ajv({ allErrors: true, strict: false } as any)
const paramsSchemaCache = new WeakMap<
  Record<string, unknown>,
  ValidateFunction
>()

export function defaultWebhookSourceSubscriptionLifetime(): SubscriptionLifetime {
  return { ...DEFAULT_LIFETIME }
}

export function webhookSourceSubscriptionManifestKey(id: string): string {
  return `webhook-source:${id}`
}

export function buildWebhookSourceSubscriptionId(input: {
  webhookKey: string
  bucketKey?: string
  params?: Record<string, unknown>
  filterKey?: string
}): string {
  const prefix = normalizeIdentifierPart(
    [input.webhookKey, input.bucketKey ?? `root`, input.filterKey]
      .filter(Boolean)
      .join(`-`)
  )
  return `${prefix}-${hashString(stableJson(input))}`
}

export function renderWebhookSourceBucketPath(
  bucket: WebhookSourceBucket,
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

export function resolveWebhookSourceSubscription(input: {
  contract: WebhookSourceContract
  entityUrl: string
  request: WebhookSourceSubscriptionInput
  createdBy?: WebhookSourceSubscription[`createdBy`]
  createdAt?: string
}): ResolvedWebhookSourceSubscription {
  const { contract, request } = input
  if (!contract.agentVisible || contract.status !== `active`) {
    throw new Error(`Webhook source "${contract.webhookKey}" is not active`)
  }
  if (request.webhookKey !== contract.webhookKey) {
    throw new Error(
      `Webhook key mismatch: expected ${contract.webhookKey}, got ${request.webhookKey}`
    )
  }

  const params = request.params ?? {}
  const bucket = request.bucketKey
    ? contract.buckets.find((candidate) => candidate.key === request.bucketKey)
    : undefined
  if (request.bucketKey && !bucket) {
    throw new Error(
      `Unknown bucket "${request.bucketKey}" for webhook source "${contract.webhookKey}"`
    )
  }

  if (
    request.filterKey &&
    !bucket?.filters?.some((f) => f.key === request.filterKey)
  ) {
    throw new Error(
      `Unknown filter "${request.filterKey}" for webhook source "${contract.webhookKey}"`
    )
  }

  if (bucket) {
    validateBucketParams(bucket, params)
  }

  const bucketPath = bucket
    ? renderWebhookSourceBucketPath(bucket, params)
    : undefined
  const sourceUrl = getWebhookStreamPath(contract.endpointKey, bucketPath)
  const id =
    request.id ??
    buildWebhookSourceSubscriptionId({
      webhookKey: request.webhookKey,
      bucketKey: request.bucketKey,
      params,
      filterKey: request.filterKey,
    })
  const manifestKey = webhookSourceSubscriptionManifestKey(id)

  return {
    contract,
    ...(bucket ? { bucket } : {}),
    ...(bucketPath ? { bucketPath } : {}),
    subscription: {
      id,
      entityUrl: input.entityUrl,
      webhookKey: contract.webhookKey,
      ...(request.bucketKey ? { bucketKey: request.bucketKey } : {}),
      params,
      ...(request.filterKey ? { filterKey: request.filterKey } : {}),
      filterApplied: false,
      contractRevision: contract.revision,
      sourceUrl,
      sourceType: contract.sourceType,
      manifestKey,
      lifetime: request.lifetime ?? defaultWebhookSourceSubscriptionLifetime(),
      ...(request.reason ? { reason: request.reason } : {}),
      createdBy: input.createdBy ?? `tool`,
      createdAt: input.createdAt ?? new Date().toISOString(),
    },
  }
}

function validateBucketParams(
  bucket: WebhookSourceBucket,
  params: Record<string, unknown>
): void {
  const schema = bucket.paramsSchema
  let validate = paramsSchemaCache.get(schema)

  if (!validate) {
    try {
      validate = paramsSchemaValidator.compile(schema)
    } catch (error) {
      throw new Error(
        `Invalid paramsSchema for bucket "${bucket.key}": ${error instanceof Error ? error.message : String(error)}`
      )
    }
    paramsSchemaCache.set(schema, validate)
  }

  if (validate(params)) return

  throw new Error(
    `Bucket params do not match paramsSchema for "${bucket.key}": ${formatParamsSchemaErrors(validate.errors)}`
  )
}

function formatParamsSchemaErrors(
  errors: Array<ErrorObject> | null | undefined
): string {
  if (!errors || errors.length === 0) return `validation failed`
  return errors.map(formatParamsSchemaError).join(`; `)
}

function formatParamsSchemaError(error: ErrorObject): string {
  const missingProperty =
    error.keyword === `required` &&
    typeof (error.params as { missingProperty?: unknown }).missingProperty ===
      `string`
      ? (error.params as { missingProperty: string }).missingProperty
      : undefined
  const instancePath = (error as ErrorObject & { instancePath?: string })
    .instancePath
  const path = instancePath || (missingProperty ? `/${missingProperty}` : `/`)
  return `${path} ${error.message ?? `is invalid`}`
}

export function buildWebhookSourceManifestEntry(
  resolved: ResolvedWebhookSourceSubscription
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
      webhookSource: {
        id: subscription.id,
        webhookKey: subscription.webhookKey,
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

export function webhookSourceWakeInfoFromManifests(input: {
  wakeEvent: {
    type?: unknown
    source?: unknown
    payload?: unknown
  }
  manifests: Array<unknown>
}): WebhookSourceWakeInfo | null {
  const wakePayload = asRecord(input.wakeEvent.payload)
  const sourceUrl =
    typeof wakePayload?.source === `string`
      ? wakePayload.source
      : typeof input.wakeEvent.source === `string`
        ? input.wakeEvent.source
        : null
  if (input.wakeEvent.type !== `wake` || !sourceUrl) return null

  const changes = normalizeWebhookSourceWakeChanges(wakePayload?.changes)
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
    const webhookSource = asRecord(config?.webhookSource)
    if (!config || !webhookSource) continue
    if (config.streamUrl !== sourceUrl) continue

    const endpointKey = stringFrom(config.endpointKey)
    const webhookKey = stringFrom(webhookSource.webhookKey)
    const subscriptionId = stringFrom(webhookSource.id)
    if (!endpointKey || !webhookKey || !subscriptionId) continue

    return {
      sourceUrl,
      sourceType: `webhook`,
      endpointKey,
      webhookKey,
      subscriptionId,
      ...(typeof config.bucket === `string` ? { bucket: config.bucket } : {}),
      ...(typeof webhookSource.bucketKey === `string`
        ? { bucketKey: webhookSource.bucketKey }
        : {}),
      params: asRecord(webhookSource.params) ?? {},
      ...(typeof webhookSource.filterKey === `string`
        ? { filterKey: webhookSource.filterKey }
        : {}),
      ...(typeof webhookSource.reason === `string`
        ? { reason: webhookSource.reason }
        : {}),
      changes,
    }
  }

  return null
}

export function buildHydratedWebhookSourceWake(
  info: WebhookSourceWakeInfo,
  events: Array<WebhookEventRow>
): HydratedWebhookSourceWake {
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
    type: `webhook_source_wake`,
    source: info.sourceUrl,
    sourceType: info.sourceType,
    endpointKey: info.endpointKey,
    webhookKey: info.webhookKey,
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
  return normalized.length > 0 ? normalized.slice(0, 80) : `webhook-source`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === `object` && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringFrom(value: unknown): string | null {
  return typeof value === `string` && value.length > 0 ? value : null
}

function normalizeWebhookSourceWakeChanges(
  value: unknown
): Array<WebhookSourceWakeChange> {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): Array<WebhookSourceWakeChange> => {
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
