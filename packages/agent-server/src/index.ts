export { ElectricAgentsServer } from './server.js'
export type { ElectricAgentsServerOptions } from './server.js'
export { StreamClient } from './stream-client.js'
export type {
  ConsumerStateResponse,
  StreamAppendResult,
  StreamMessage,
  StreamReadResult,
  WaitForMessagesResult,
} from './stream-client.js'

export {
  ElectricAgentsManager,
  ElectricAgentsError,
} from './electric-agents-manager.js'
export { PostgresRegistry } from './electric-agents-registry.js'
export { ElectricAgentsRoutes } from './electric-agents-routes.js'
export { ElectricAgentsEntityTypeRoutes } from './electric-agents-entity-type-routes.js'
export { assertEntityStatus, toPublicEntity } from './electric-agents-types.js'
export type {
  ElectricAgentsEntity,
  ElectricAgentsEntityRow,
  ElectricAgentsEntityType,
  EntityStatus,
  PublicElectricAgentsEntity,
  TypedSpawnRequest,
  SendRequest,
  RegisterEntityTypeRequest,
  EntityListFilter,
} from './electric-agents-types.js'
export { SchemaValidator } from './electric-agents-schema-validator.js'
export { WakeRegistry } from './wake-registry.js'
export type { WakeEvalResult } from './wake-registry.js'

export {
  createAgentHandler,
  registerAgentTypes,
} from './electric-agents/bootstrap.js'
export type { AgentHandlerResult } from './electric-agents/bootstrap.js'
export type {
  WriteEvent,
  StreamEvent,
  AgentAdapter,
  AgentTypeConfig,
  AgentTypeDefinition,
  CreateAdapter,
} from './electric-agents/adapter-types.js'
export { DEFAULT_OUTPUT_SCHEMAS } from './electric-agents/default-entity-schemas.js'
export { createBashTool } from './electric-agents/tools/bash.js'
export { createReadFileTool } from './electric-agents/tools/read-file.js'
export { braveSearchTool } from './electric-agents/tools/brave-search.js'
export { fetchUrlTool } from './electric-agents/tools/fetch-url.js'
export { createScheduleTools } from './electric-agents/tools/schedules.js'
