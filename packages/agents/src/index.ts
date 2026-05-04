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
