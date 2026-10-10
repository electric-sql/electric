import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import {
  buildWebhookSourceSubscriptionId,
  defaultWebhookSourceSubscriptionLifetime,
  webhookSourceSubscriptionManifestKey,
} from '../webhook-sources'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { EntityStreamDBWithActions } from '../types'
import type {
  WebhookSourceContract,
  WebhookSourceSubscription,
  WebhookSourceSubscriptionInput,
  SubscriptionLifetime,
} from '../webhook-sources'

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

function withWebhookSourceToolLogging<TParams>(
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

function isWebhookSourceManifest(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind !== `source` || value.sourceType !== `webhook`) return false
  const config = value.config
  return (
    isRecord(config) &&
    isRecord(config.webhookSource) &&
    typeof config.webhookSource.id === `string`
  )
}

function getWebhookSourceSubscriptions(
  entityUrl: string,
  db: EntityStreamDBWithActions
): Array<WebhookSourceSubscription> {
  const entries: Array<WebhookSourceSubscription> = []

  for (const entry of db.collections.manifests.toArray) {
    if (!isWebhookSourceManifest(entry)) continue
    const manifest = entry as Record<string, unknown>
    const config = manifest.config as Record<string, unknown>
    const webhookSource = config.webhookSource as Record<string, unknown>
    const id = String(webhookSource.id)
    const lifetime = isRecord(webhookSource.lifetime)
      ? (webhookSource.lifetime as SubscriptionLifetime)
      : defaultWebhookSourceSubscriptionLifetime()

    entries.push({
      id,
      entityUrl,
      webhookKey:
        typeof webhookSource.webhookKey === `string`
          ? webhookSource.webhookKey
          : String(config.endpointKey ?? ``),
      ...(typeof webhookSource.bucketKey === `string`
        ? { bucketKey: webhookSource.bucketKey }
        : {}),
      params: isRecord(webhookSource.params) ? webhookSource.params : {},
      ...(typeof webhookSource.filterKey === `string`
        ? { filterKey: webhookSource.filterKey }
        : {}),
      filterApplied: webhookSource.filterApplied === true,
      contractRevision:
        typeof webhookSource.contractRevision === `number`
          ? webhookSource.contractRevision
          : 0,
      sourceUrl:
        typeof config.streamUrl === `string`
          ? config.streamUrl
          : String(manifest.sourceRef ?? ``),
      sourceType: `webhook`,
      manifestKey:
        typeof manifest.key === `string`
          ? manifest.key
          : webhookSourceSubscriptionManifestKey(id),
      lifetime,
      ...(typeof webhookSource.reason === `string`
        ? { reason: webhookSource.reason }
        : {}),
      createdBy:
        webhookSource.createdBy === `handler` ||
        webhookSource.createdBy === `user` ||
        webhookSource.createdBy === `system`
          ? webhookSource.createdBy
          : `tool`,
      createdAt:
        typeof webhookSource.createdAt === `string`
          ? webhookSource.createdAt
          : new Date(0).toISOString(),
    })
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

function getWebhookSourceSubscription(
  entityUrl: string,
  db: EntityStreamDBWithActions,
  id: string
): WebhookSourceSubscription | undefined {
  return getWebhookSourceSubscriptions(entityUrl, db).find(
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

export function createWebhookSourceTools(opts: {
  entityUrl: string
  db: EntityStreamDBWithActions
  listWebhookSources: () => Promise<Array<WebhookSourceContract>>
  subscribeToWebhookSource: (
    opts: WebhookSourceSubscriptionInput
  ) => Promise<{ txid: string; subscription: WebhookSourceSubscription }>
  unsubscribeFromWebhookSource: (opts: {
    id: string
  }) => Promise<{ txid: string }>
}): Array<AgentTool> {
  const {
    db,
    entityUrl,
    listWebhookSources,
    subscribeToWebhookSource,
    unsubscribeFromWebhookSource,
  } = opts

  const listSourcesTool: AgentTool = {
    name: `list_webhook_sources`,
    label: `List Webhook Sources`,
    description: `List external webhook feeds you can subscribe to, such as GitHub, Stripe, email, CI, or other webhook integrations. Webhook sources may expose named buckets and optional filters; use paramsSchema to choose webhookKey, bucketKey, params, and filterKey for subscribe_webhook_source.`,
    parameters: Type.Object({}),
    execute: withWebhookSourceToolLogging(
      entityUrl,
      `list_webhook_sources`,
      async () => asToolResult(await listWebhookSources())
    ),
  }

  const listSubscriptionsTool: AgentTool = {
    name: `list_webhook_source_subscriptions`,
    label: `List Webhook Source Subscriptions`,
    description: `List your active webhook source subscriptions: external feeds and buckets that are currently configured to wake you when matching events arrive.`,
    parameters: Type.Object({}),
    execute: withWebhookSourceToolLogging(
      entityUrl,
      `list_webhook_source_subscriptions`,
      async () => asToolResult(getWebhookSourceSubscriptions(entityUrl, db))
    ),
  }

  const subscribeTool: AgentTool = {
    name: `subscribe_webhook_source`,
    label: `Subscribe Webhook Source`,
    description: `Subscribe to a discoverable external webhook feed or one of its buckets so matching future webhooks wake you with the matching webhook data in your next message. Use filterKey only when list_webhook_sources advertises a named filter you want; filters are advisory until server-side webhook filters are enabled.`,
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({
          description: `Optional stable subscription id. Defaults to a deterministic id from webhookKey, bucketKey, params, and filterKey.`,
        })
      ),
      webhookKey: Type.String({
        description: `Webhook source key from list_webhook_sources`,
      }),
      bucketKey: Type.Optional(
        Type.String({
          description: `Bucket key from list_webhook_sources. Omit to subscribe to the source root stream.`,
        })
      ),
      params: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: `Values for the selected bucket template, matching its paramsSchema.`,
        })
      ),
      filterKey: Type.Optional(
        Type.String({
          description: `Optional named filter key advertised by the source. Advisory in this version.`,
        })
      ),
      lifetime: Type.Optional(lifetimeSchema),
      reason: Type.Optional(
        Type.String({
          description: `Short human-readable reason for this subscription`,
        })
      ),
    }),
    execute: withWebhookSourceToolLogging(
      entityUrl,
      `subscribe_webhook_source`,
      async (_toolCallId, params) => {
        const parsed = params as WebhookSourceSubscriptionInput
        const id =
          parsed.id ??
          buildWebhookSourceSubscriptionId({
            webhookKey: parsed.webhookKey,
            bucketKey: parsed.bucketKey,
            params: parsed.params,
            filterKey: parsed.filterKey,
          })
        const { txid, subscription } = await subscribeToWebhookSource({
          ...parsed,
          id,
          lifetime:
            parsed.lifetime ?? defaultWebhookSourceSubscriptionLifetime(),
        })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult(
          getWebhookSourceSubscription(entityUrl, db, id) ?? subscription
        )
      }
    ),
  }

  const unsubscribeTool: AgentTool = {
    name: `unsubscribe_webhook_source`,
    label: `Unsubscribe Webhook Source`,
    description: `Stop being woken by a webhook source subscription.`,
    parameters: Type.Object({
      id: Type.String({ description: `Subscription id` }),
    }),
    execute: withWebhookSourceToolLogging(
      entityUrl,
      `unsubscribe_webhook_source`,
      async (_toolCallId, params) => {
        const { id } = params as { id: string }
        const existing = getWebhookSourceSubscription(entityUrl, db, id)
        if (!existing) {
          return asToolResult(
            `No webhook source subscription found for id "${id}"`
          )
        }
        const { txid } = await unsubscribeFromWebhookSource({ id })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult({
          deleted: true,
          id,
          key: webhookSourceSubscriptionManifestKey(id),
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
