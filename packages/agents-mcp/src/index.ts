export const VERSION = `0.1.0-experimental.0`
export const EXPERIMENTAL = true

let warned = false
function warnExperimental(): void {
  if (warned) return
  warned = true

  console.warn(
    `[@electric-ax/agents-mcp] EXPERIMENTAL — public surfaces may change without a deprecation cycle.`
  )
}
warnExperimental()

export * from './types'
export * from './credentials/types'
export { inMemoryCredentialStore } from './credentials/in-memory'
export { envCredentialStore } from './credentials/env'
export { fileCredentialStore } from './credentials/file'
export { osKeychainCredentialStore } from './credentials/os-keychain'
export { composedCredentialStore } from './credentials/composed'

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
} from './registry'

export { loadConfig, parseConfig } from './config/loader'
export type { McpConfig } from './config/loader'

export { watchConfig } from './config/watcher'
export type { WatchOpts } from './config/watcher'

export { mountMcpHttp } from './http/mount'
export type { MountMcpHttpOpts } from './http/mount'

export { bridgeMcpTool, prefixToolName } from './bridge/tool-bridge'
export type { BridgeToolOpts, BridgedTool } from './bridge/tool-bridge'

export { buildResourceTools } from './bridge/resource-bridge'
export type { BuildResourceToolsOpts } from './bridge/resource-bridge'
export { buildPromptTools } from './bridge/prompt-bridge'
export type { BuildPromptToolsOpts } from './bridge/prompt-bridge'
