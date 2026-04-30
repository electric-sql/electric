export type {
  CodingAgentKind,
  SandboxSpec,
  ExecRequest,
  ExecHandle,
  SandboxInstance,
  SandboxProvider,
  RecoveredSandbox,
  RunTurnArgs,
  RunTurnResult,
  Bridge,
  SpawnCodingAgentOptions,
  RunSummary,
  CodingAgentStatus,
} from './types'
export { LocalDockerProvider } from './providers/local-docker'
export { StdioBridge } from './bridge/stdio-bridge'
export { LifecycleManager } from './lifecycle-manager'
export { WorkspaceRegistry } from './workspace-registry'
export {
  registerCodingAgent,
  type RegisterCodingAgentDeps,
} from './entity/register'
export {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE,
} from './entity/collections'
