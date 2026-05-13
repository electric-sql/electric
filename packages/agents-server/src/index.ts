export { createDb, runMigrations } from './db/index.js'
export type { DrizzleDB, PgClient } from './db/index.js'
export { AgentsHost } from './host.js'
export type {
  AgentsHostOptions,
  AgentsHostTenantConfig,
  AgentsHostTenantRuntime,
} from './host.js'
export { StreamClient } from './stream-client.js'
export type {
  DurableStreamsBearerProvider,
  StreamClientOptions,
  SubscriptionClaimResponse,
  SubscriptionCreateInput,
  SubscriptionResponse,
  SubscriptionStreamInfo,
} from './stream-client.js'
export type {
  AuthenticatedRequestUser,
  AuthenticateRequest,
  ConsumerClaim,
  DispatchPolicy,
  DispatchTarget,
  ElectricAgentsRunner,
  ElectricAgentsUser,
  EntityDispatchState,
  PublicWakeNotification,
  RegisterRunnerRequest,
  RunnerAdminStatus,
  RunnerHeartbeatRequest,
  RunnerKind,
  RunnerLiveness,
  SourceStreamOffset,
  WakeNotificationRow,
} from './electric-agents-types.js'
export { globalRouter } from './routing/global-router.js'
export type { GlobalRoutes } from './routing/global-router.js'
export type { TenantContext } from './routing/context.js'
export { pathPrefixedSingleTenantDurableStreamsRoutingAdapter } from './routing/durable-streams-routing-adapter.js'
export type {
  DurableStreamsRoutingAdapter,
  DurableStreamsRoutingInput,
} from './routing/durable-streams-routing-adapter.js'
export type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
export {
  DEFAULT_TENANT_ID,
  UnregisteredTenantError,
  isUnregisteredTenantError,
} from './tenant.js'
