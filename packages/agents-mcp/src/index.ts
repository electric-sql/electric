export const VERSION = `0.1.0`

export * from './types'

export {
  mcp,
  isMcpToolsSentinel,
  filterByAllowlist,
  MCP_TOOLS_SENTINEL,
} from './tools'
export type { McpToolsSentinel } from './tools'

export { createRegistry } from './registry'
export type {
  Registry,
  RegistryOpts,
  ListedEntry,
  HeaderProvider,
  RegistrySnapshot,
  RegistrySubscriber,
} from './registry'

export { loadConfig, parseConfig } from './config/loader'
export type { McpConfig } from './config/loader'

export { watchConfig } from './config/watcher'
export type { WatchOpts } from './config/watcher'

export { bridgeMcpTool, prefixToolName } from './bridge/tool-bridge'
export type { BridgeToolOpts, BridgedTool } from './bridge/tool-bridge'

export { buildResourceTools } from './bridge/resource-bridge'
export type { BuildResourceToolsOpts } from './bridge/resource-bridge'
export { buildPromptTools } from './bridge/prompt-bridge'
export type { BuildPromptToolsOpts } from './bridge/prompt-bridge'

// Opt-in persistence helpers — produce the auth-config slice
// ({tokens, client, onTokensChanged, onClientRegistered}) the registry
// expects. Use one of these for OAuth servers when you want tokens to
// survive process restarts; bring your own for Vault / SSM / etc.
export { keychainPersistence } from './persistence/keychain'
export type { KeychainPersistenceOpts } from './persistence/keychain'
export { filePersistence } from './persistence/file'
export type { FilePersistenceOpts } from './persistence/file'
