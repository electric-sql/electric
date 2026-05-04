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
export { HostProvider } from './providers/host'
export { FlySpriteProvider } from './providers/fly-sprites'
import { FlySpriteProvider } from './providers/fly-sprites'

// Eager registration only matters for sideEffect tracking; the actual
// provider instances are built by callers. But export a factory:
export function createSpritesProviderIfConfigured():
  | FlySpriteProvider
  | undefined {
  if (!process.env.SPRITES_TOKEN) return undefined
  return new FlySpriteProvider()
}
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

// Register built-in adapters by importing for side effects.
import './agents/claude'
import './agents/codex'
import './agents/opencode'

export { getAdapter, listAdapters, registerAdapter } from './agents/registry'
export type { CodingAgentAdapter } from './agents/registry'
