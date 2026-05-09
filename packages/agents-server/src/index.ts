export { ElectricAgentsServer } from './server.js'
export type { ElectricAgentsServerOptions } from './server.js'
export { StreamClient } from './stream-client.js'
export {
  DEV_ASSERTED_EMAIL_HEADER,
  DEV_ASSERTED_NAME_HEADER,
  createDevAssertedAuthenticateRequest,
  devAssertedAuthOptionsFromEnv,
} from './dev-asserted-auth.js'
export type { DevAssertedAuthOptions } from './dev-asserted-auth.js'
export type {
  ConsumerStateResponse,
  MintWakeNotificationRequest,
  MintWakeNotificationResponse,
  StreamAppendResult,
  StreamMessage,
  StreamReadResult,
  WaitForMessagesResult,
} from './stream-client.js'
export {
  DispatchWakeRouter,
  consumerIdForEntity,
  runnerWakeStream,
  redactWakeNotification,
} from './dispatch-wake-router.js'
export type {
  DispatchWakeDeliveredInput,
  DispatchWakeDeliveryResult,
  DispatchWakeFailedInput,
  DispatchWakeMaterializationInput,
  DispatchWakeMaterializationResult,
  DispatchWakeMaterializationStatus,
  DispatchWakeRouterEntityLookup,
  DispatchWakeRouterOptions,
} from './dispatch-wake-router.js'

export {
  ElectricAgentsManager,
  ElectricAgentsError,
} from './electric-agents-manager.js'
export { PostgresRegistry } from './electric-agents-registry.js'
export type {
  BeginDispatchWakeInput,
  BeginDispatchWakeResult,
  HeartbeatRunnerInput,
  MarkWakeDeliveredInput,
  MarkWakeFailedInput,
  RegisterRunnerInput,
} from './electric-agents-registry.js'
export { ElectricAgentsRoutes } from './electric-agents-routes.js'
export { ElectricAgentsEntityTypeRoutes } from './electric-agents-entity-type-routes.js'
export {
  assertEntityStatus,
  assertRunnerAdminStatus,
  assertRunnerKind,
  toPublicEntity,
} from './electric-agents-types.js'
export type {
  AuthenticatedRequestUser,
  AuthenticateRequest,
  DispatchPolicy,
  DispatchTarget,
  ElectricAgentsEntity,
  ElectricAgentsEntityRow,
  ElectricAgentsEntityType,
  ElectricAgentsRunner,
  EntityStatus,
  PublicElectricAgentsEntity,
  PublicWakeNotification,
  RegisterRunnerRequest,
  RunnerAdminStatus,
  RunnerHeartbeatRequest,
  RunnerKind,
  RunnerLiveness,
  TypedSpawnRequest,
  SendRequest,
  RegisterEntityTypeRequest,
  EntityListFilter,
} from './electric-agents-types.js'
export { SchemaValidator } from './electric-agents-schema-validator.js'
export { WakeRegistry } from './wake-registry.js'
export type { WakeEvalResult } from './wake-registry.js'
export type {
  WriteEvent,
  StreamEvent,
  AgentAdapter,
  AgentTypeConfig,
  AgentTypeDefinition,
  CreateAdapter,
} from './electric-agents/adapter-types.js'
export { DEFAULT_OUTPUT_SCHEMAS } from './electric-agents/default-entity-schemas.js'
