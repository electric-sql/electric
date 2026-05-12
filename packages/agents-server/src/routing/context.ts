import type { Agent } from 'undici'
import type { DrizzleDB } from '../db/index.js'
import type { EntityBridgeCoordinator } from '../entity-bridge-manager.js'
import type { EntityManager } from '../entity-manager.js'
import type { ElectricAgentsTenantRuntime } from '../runtime.js'
import type { StreamClient } from '../stream-client.js'
import type { DurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import type { AuthenticatedRequestUser } from '../electric-agents-types.js'

/**
 * Per-request tenant context passed through every router and handler.
 *
 * The OSS server builds this from its single runtime. Library-mode callers can
 * build one per request and call `globalRouter.fetch(request, ctx)` directly.
 */
export interface TenantContext {
  service: string
  authenticatedUser?: AuthenticatedRequestUser
  publicUrl: string
  localUrl?: string
  durableStreamsUrl: string
  durableStreamsRouting?: DurableStreamsRoutingAdapter
  durableStreamsDispatcher: Agent
  electricUrl?: string
  electricSecret?: string
  ownAgentHandlerPaths?: ReadonlyArray<string>
  pgDb: DrizzleDB
  entityManager: EntityManager
  streamClient: StreamClient
  runtime: ElectricAgentsTenantRuntime
  entityBridgeManager: EntityBridgeCoordinator
  isShuttingDown: () => boolean
}
