// Types
export type {
  McpServerConfig,
  McpConfig,
  McpOverrides,
  McpIntegration,
  McpServerStatus,
  McpServerState,
  McpDiscoveredTool,
  McpDiscoveredResource,
} from './types'

export { MCP_DEFAULTS } from './types'

// Main entry point
export { createMcpIntegration } from './integration'

// Sub-modules (for advanced usage)
export { McpClientPool } from './pool'
export { McpClient } from './client'
export { ConfigStore } from './config/config-store'
export { TokenStore } from './auth/token-store'
export { bridgeMcpTools } from './bridge/tool-bridge'
export { createResourceTools } from './bridge/resource-bridge'
export { createConfigTools } from './config/config-tools'
export { expandEnvVars, expandConfigValues } from './config/env-expand'
