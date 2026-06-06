import type { Agent } from 'undici'
import type {
  EventSourceContract,
  WebhookSignatureVerifierConfig,
} from '@electric-ax/agents-runtime'
import type { DrizzleDB } from '../db/index.js'
import type { EntityBridgeCoordinator } from '../entity-bridge-manager.js'
import type { PgSyncBridgeCoordinator } from '../pg-sync-bridge-manager.js'
import type { EntityManager } from '../entity-manager.js'
import type { ElectricAgentsTenantRuntime } from '../runtime.js'
import type { StreamClient } from '../stream-client.js'
import type { DurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import type { Principal } from '../principal.js'
import type { DurableStreamsBearerProvider } from '../stream-client.js'
import type { WebhookSigner } from '../webhook-signing.js'
import type { AuthorizeRequest } from '../electric-agents-types.js'

export interface EventSourceCatalog {
  listEventSources: () =>
    | Array<EventSourceContract>
    | Promise<Array<EventSourceContract>>
  getEventSource: (
    sourceKey: string
  ) =>
    | EventSourceContract
    | undefined
    | Promise<EventSourceContract | undefined>
}

/**
 * Per-request tenant context passed through every router and handler.
 *
 * The OSS server builds this from its single runtime. Library-mode callers can
 * build one per request and call `globalRouter.fetch(request, ctx)` directly.
 */
export interface TenantContext {
  service: string
  principal: Principal
  publicUrl: string
  localUrl?: string
  /** Durable Streams backend URL prefix. Stream and control paths are appended as-is. */
  durableStreamsUrl: string
  durableStreamsBearer?: DurableStreamsBearerProvider
  durableStreamsRouting?: DurableStreamsRoutingAdapter
  durableStreamsDispatcher: Agent
  durableStreamsWebhookSignature?:
    | false
    | Partial<WebhookSignatureVerifierConfig>
  webhookSigner?: WebhookSigner
  electricUrl?: string
  electricSecret?: string
  ownAgentHandlerPaths?: ReadonlyArray<string>
  pgDb: DrizzleDB
  entityManager: EntityManager
  streamClient: StreamClient
  runtime: ElectricAgentsTenantRuntime
  entityBridgeManager: EntityBridgeCoordinator
  pgSyncBridgeManager?: PgSyncBridgeCoordinator
  eventSources?: EventSourceCatalog
  ensureEventSourceWakeSource?: (sourceUrl: string) => Promise<void> | void
  authorizeRequest?: AuthorizeRequest
  isShuttingDown: () => boolean
}
