export { createDb, runMigrations } from './db/index.js'
export type { DrizzleDB, PgClient } from './db/index.js'
export { AgentsHost } from './host.js'
export type {
  RealtimeSessionCreateRequest,
  RealtimeSessionCreateResult,
} from './entity-manager.js'
export type {
  AgentsHostOptions,
  AgentsHostTenantConfig,
  AgentsHostTenantRuntime,
} from './host.js'
export { StreamClient } from './stream-client.js'
export type {
  DurableStreamsBearerProvider,
  StreamAppendOptions,
  StreamClientOptions,
  StreamIdempotentAppendOptions,
  StreamProducerHeaderAppendOptions,
  SubscriptionClaimResponse,
  SubscriptionCreateInput,
  SubscriptionResponse,
  SubscriptionStreamInfo,
} from './stream-client.js'
export {
  assertEntitySignal,
  assertEntityStatus,
  expectedSignalStatus,
  isTerminalEntityStatus,
  rejectsNormalWrites,
  toPublicEntity,
} from './electric-agents-types.js'
export type {
  AuthenticateRequest,
  ConsumerClaim,
  DispatchPolicy,
  DispatchTarget,
  ElectricAgentsRunner,
  ElectricAgentsUser,
  EntityDispatchState,
  PublicWakeNotification,
  RegisterRunnerRequest,
  RequestPrincipal,
  RunnerAdminStatus,
  RunnerHeartbeatRequest,
  RunnerKind,
  RunnerLiveness,
  SourceStreamOffset,
  WakeNotificationRow,
  ElectricAgentsEntity,
  ElectricAgentsEntityRow,
  ElectricAgentsEntityType,
  EntityPermission,
  EntityPermissionGrant,
  EntityPermissionPropagation,
  EntityTypePermission,
  EntityTypePermissionGrant,
  EntityTypePermissionGrantInput,
  EntityStatus,
  EntitySignal,
  PublicElectricAgentsEntity,
  EntityListFilter,
  RegisterEntityTypeRequest,
  SendRequest,
  SignalRequest,
  SignalResponse,
  TypedSpawnRequest,
  PermissionSubject,
  PermissionSubjectKind,
  AuthorizationDecision,
  AuthorizationResource,
  AuthorizeRequest,
} from './electric-agents-types.js'
export type {
  WebhookSourceBucket,
  WebhookSourceContract,
  WebhookSourceFilter,
  WebhookSourceSubscription,
  WebhookSourceSubscriptionInput,
  SubscriptionLifetime,
} from '@electric-ax/agents-runtime'
export type { Principal, PrincipalKind } from './principal.js'
export { globalRouter } from './routing/global-router.js'
export type { GlobalRoutes } from './routing/global-router.js'
export type { WebhookSourceCatalog, TenantContext } from './routing/context.js'
export {
  streamRootDurableStreamsRoutingAdapter,
  pathPrefixedSingleTenantDurableStreamsRoutingAdapter,
  tenantRootDurableStreamsRoutingAdapter,
} from './routing/durable-streams-routing-adapter.js'
export type {
  DurableStreamsRoutingAdapter,
  DurableStreamsRoutingInput,
} from './routing/durable-streams-routing-adapter.js'
export {
  createEd25519WebhookSigner,
  getDefaultWebhookSigner,
  webhookSigningMetadata,
} from './webhook-signing.js'
export type {
  Ed25519WebhookSignerOptions,
  WebhookJwks,
  WebhookPublicJwk,
  WebhookSigner,
  WebhookSigningKeyInput,
  WebhookSigningMetadata,
} from './webhook-signing.js'
export type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
export {
  DEFAULT_TENANT_ID,
  UnregisteredTenantError,
  isUnregisteredTenantError,
} from './tenant.js'
