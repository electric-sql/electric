export {
  DEFAULT_BUILTIN_AGENT_HANDLER_PATH,
  createBuiltinAgentHandler,
  createAgentHandler,
  registerBuiltinAgentTypes,
  registerAgentTypes,
} from './bootstrap.js'
export type {
  AgentHandlerResult,
  BuiltinAgentHandlerOptions,
} from './bootstrap.js'

export { BuiltinAgentsServer } from './server.js'
export type { BuiltinAgentsServerOptions } from './server.js'

// Re-export the MCP types embedders need to talk to the registry
// (e.g. the Electron desktop app subscribes to state changes from
// `BuiltinAgentsServer.mcpRegistry` and forwards over IPC).
export type {
  Registry as McpRegistry,
  RegistrySnapshot,
  RegistrySubscriber,
  ListedEntry as McpListedEntry,
  McpServerConfig,
  McpConfig,
} from '@electric-ax/agents-mcp'

export {
  resolveBuiltinAgentsEntrypointOptions,
  runBuiltinAgentsEntrypoint,
} from './entrypoint-lib.js'
export type {
  BuiltinAgentsEntrypointOptions,
  BuiltinAgentsEntrypointServer,
  RunBuiltinAgentsEntrypointOptions,
} from './entrypoint-lib.js'

export {
  buildHortonSystemPrompt,
  createHortonTools,
  generateTitle,
  HORTON_MODEL,
  registerHorton,
} from './agents/horton.js'
export { registerWorker } from './agents/worker.js'
export {
  WORKER_TOOL_NAMES,
  createSpawnWorkerTool,
} from './tools/spawn-worker.js'
export type { WorkerToolName } from './tools/spawn-worker.js'
export { createHortonDocsSupport } from './docs/knowledge-base.js'
export { braveSearchTool } from '@electric-ax/agents-runtime/tools'
