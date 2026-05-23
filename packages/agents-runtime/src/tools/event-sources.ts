import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import {
  buildEventSourceSubscriptionId,
  defaultEventSourceSubscriptionLifetime,
  eventSourceSubscriptionManifestKey,
} from '../event-sources'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { EntityStreamDBWithActions } from '../entity-stream-db'
import type {
  EventSourceContract,
  EventSourceSubscription,
  EventSourceSubscriptionInput,
  SubscriptionLifetime,
} from '../event-sources'

type ToolResult = {
  content: Array<{ type: `text`; text: string }>
  details: Record<string, unknown>
}

function asToolResult(value: unknown): ToolResult {
  return {
    content: [
      {
        type: `text`,
        text:
          typeof value === `string` ? value : JSON.stringify(value, null, 2),
      },
    ],
    details: {},
  }
}

function formatForLog(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function withEventSourceToolLogging<TParams>(
  entityUrl: string,
  toolName: string,
  execute: (
    toolCallId: string | undefined,
    params: TParams
  ) => Promise<ToolResult>
): (toolCallId: string | undefined, params: TParams) => Promise<ToolResult> {
  return async (toolCallId, params) => {
    runtimeLog.info(
      `[${entityUrl}]`,
      `${toolName} start toolCallId=${toolCallId ?? `none`} params=${formatForLog(params)}`
    )

    try {
      const result = await execute(toolCallId, params)
      runtimeLog.info(
        `[${entityUrl}]`,
        `${toolName} success toolCallId=${toolCallId ?? `none`} result=${formatForLog(result)}`
      )
      return result
    } catch (error) {
      runtimeLog.error(
        `[${entityUrl}]`,
        `${toolName} failed toolCallId=${toolCallId ?? `none`} params=${formatForLog(params)} error=${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      )
      throw error
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

function isEventSourceManifest(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind !== `source` || value.sourceType !== `webhook`) return false
  const config = value.config
  return (
    isRecord(config) &&
    isRecord(config.eventSource) &&
    typeof config.eventSource.id === `string`
  )
}

function getEventSourceSubscriptions(
  entityUrl: string,
  db: EntityStreamDBWithActions
): Array<EventSourceSubscription> {
  const entries: Array<EventSourceSubscription> = []

  for (const entry of db.collections.manifests.toArray) {
    if (!isEventSourceManifest(entry)) continue
    const manifest = entry as Record<string, unknown>
    const config = manifest.config as Record<string, unknown>
    const eventSource = config.eventSource as Record<string, unknown>
    const id = String(eventSource.id)
    const lifetime = isRecord(eventSource.lifetime)
      ? (eventSource.lifetime as SubscriptionLifetime)
      : defaultEventSourceSubscriptionLifetime()

    entries.push({
      id,
      entityUrl,
      sourceKey:
        typeof eventSource.sourceKey === `string`
          ? eventSource.sourceKey
          : String(config.endpointKey ?? ``),
      ...(typeof eventSource.bucketKey === `string`
        ? { bucketKey: eventSource.bucketKey }
        : {}),
      params: isRecord(eventSource.params) ? eventSource.params : {},
      ...(typeof eventSource.filterKey === `string`
        ? { filterKey: eventSource.filterKey }
        : {}),
      filterApplied: eventSource.filterApplied === true,
      contractRevision:
        typeof eventSource.contractRevision === `number`
          ? eventSource.contractRevision
          : 0,
      sourceUrl:
        typeof config.streamUrl === `string`
          ? config.streamUrl
          : String(manifest.sourceRef ?? ``),
      sourceType: `webhook`,
      manifestKey:
        typeof manifest.key === `string`
          ? manifest.key
          : eventSourceSubscriptionManifestKey(id),
      lifetime,
      ...(typeof eventSource.reason === `string`
        ? { reason: eventSource.reason }
        : {}),
      createdBy:
        eventSource.createdBy === `handler` ||
        eventSource.createdBy === `user` ||
        eventSource.createdBy === `system`
          ? eventSource.createdBy
          : `tool`,
      createdAt:
        typeof eventSource.createdAt === `string`
          ? eventSource.createdAt
          : new Date(0).toISOString(),
    })
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

function getEventSourceSubscription(
  entityUrl: string,
  db: EntityStreamDBWithActions,
  id: string
): EventSourceSubscription | undefined {
  return getEventSourceSubscriptions(entityUrl, db).find(
    (entry) => entry.id === id
  )
}

const lifetimeSchema = Type.Union([
  Type.Object({ kind: Type.Literal(`until_entity_stopped`) }),
  Type.Object({
    kind: Type.Literal(`expires_at`),
    at: Type.String({
      description: `Absolute expiration time in ISO-8601 format`,
    }),
  }),
  Type.Object({ kind: Type.Literal(`manual`) }),
])

export function createEventSourceTools(opts: {
  entityUrl: string
  db: EntityStreamDBWithActions
  listEventSources: () => Promise<Array<EventSourceContract>>
  subscribeToEventSource: (
    opts: EventSourceSubscriptionInput
  ) => Promise<{ txid: string; subscription: EventSourceSubscription }>
  unsubscribeFromEventSource: (opts: {
    id: string
  }) => Promise<{ txid: string }>
}): Array<AgentTool> {
  const {
    db,
    entityUrl,
    listEventSources,
    subscribeToEventSource,
    unsubscribeFromEventSource,
  } = opts

  const listSourcesTool: AgentTool = {
    name: `list_event_sources`,
    label: `List Event Sources`,
    description: `List event sources this entity can subscribe to. Use bucket templates and paramsSchema to choose sourceKey, bucketKey, and params for subscribe_event_source.`,
    parameters: Type.Object({}),
    execute: withEventSourceToolLogging(
      entityUrl,
      `list_event_sources`,
      async () => asToolResult(await listEventSources())
    ),
  }

  const listSubscriptionsTool: AgentTool = {
    name: `list_event_source_subscriptions`,
    label: `List Event Subscriptions`,
    description: `List this entity's active manifest-backed event source subscriptions.`,
    parameters: Type.Object({}),
    execute: withEventSourceToolLogging(
      entityUrl,
      `list_event_source_subscriptions`,
      async () => asToolResult(getEventSourceSubscriptions(entityUrl, db))
    ),
  }

  const subscribeTool: AgentTool = {
    name: `subscribe_event_source`,
    label: `Subscribe Event Source`,
    description: `Subscribe this entity to a discoverable event source bucket. The optional filterKey is recorded for provenance; precise source-event filtering is not applied until source filters are enabled server-side.`,
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({
          description: `Optional stable subscription id. Defaults to a deterministic id from sourceKey, bucketKey, params, and filterKey.`,
        })
      ),
      sourceKey: Type.String({ description: `Event source key` }),
      bucketKey: Type.Optional(
        Type.String({
          description: `Bucket template key from list_event_sources`,
        })
      ),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: `Bucket template parameters`,
        })
      ),
      filterKey: Type.Optional(
        Type.String({
          description: `Optional named filter key. Stored for provenance in this version.`,
        })
      ),
      lifetime: Type.Optional(lifetimeSchema),
      reason: Type.Optional(
        Type.String({
          description: `Short reason for this subscription`,
        })
      ),
    }),
    execute: withEventSourceToolLogging(
      entityUrl,
      `subscribe_event_source`,
      async (_toolCallId, params) => {
        const parsed = params as EventSourceSubscriptionInput
        const id =
          parsed.id ??
          buildEventSourceSubscriptionId({
            sourceKey: parsed.sourceKey,
            bucketKey: parsed.bucketKey,
            params: parsed.params,
            filterKey: parsed.filterKey,
          })
        const { txid, subscription } = await subscribeToEventSource({
          ...parsed,
          id,
          lifetime: parsed.lifetime ?? defaultEventSourceSubscriptionLifetime(),
        })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult(
          getEventSourceSubscription(entityUrl, db, id) ?? subscription
        )
      }
    ),
  }

  const unsubscribeTool: AgentTool = {
    name: `unsubscribe_event_source`,
    label: `Unsubscribe Event Source`,
    description: `Remove an event source subscription from this entity's manifest.`,
    parameters: Type.Object({
      id: Type.String({ description: `Subscription id` }),
    }),
    execute: withEventSourceToolLogging(
      entityUrl,
      `unsubscribe_event_source`,
      async (_toolCallId, params) => {
        const { id } = params as { id: string }
        const existing = getEventSourceSubscription(entityUrl, db, id)
        if (!existing) {
          return asToolResult(
            `No event source subscription found for id "${id}"`
          )
        }
        const { txid } = await unsubscribeFromEventSource({ id })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult({
          deleted: true,
          id,
          key: eventSourceSubscriptionManifestKey(id),
        })
      }
    ),
  }

  return [
    listSourcesTool,
    listSubscriptionsTool,
    subscribeTool,
    unsubscribeTool,
  ]
}
