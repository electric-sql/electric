import { registerCloudIpcHandlers } from './cloud'
import { registerChromeIpcHandlers } from './chrome'
import { registerCredentialsIpcHandlers } from './credentials'
import { registerMcpIpcHandlers } from './mcp'
import { registerRuntimeIpcHandlers } from './runtime'
import { registerServerIpcHandlers } from './servers'
import type { CloudIpcDeps } from './cloud'
import type { ChromeIpcDeps } from './chrome'
import type { CredentialsIpcDeps } from './credentials'
import type { McpIpcDeps } from './mcp'
import type { RuntimeIpcDeps } from './runtime'
import type { ServerIpcDeps } from './servers'

export type RegisterDesktopIpcDeps = ServerIpcDeps &
  RuntimeIpcDeps &
  CredentialsIpcDeps &
  CloudIpcDeps &
  McpIpcDeps &
  ChromeIpcDeps

export function registerIpcHandlers(deps: RegisterDesktopIpcDeps): void {
  registerServerIpcHandlers(deps)
  registerRuntimeIpcHandlers(deps)
  registerCredentialsIpcHandlers(deps)
  registerCloudIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerChromeIpcHandlers(deps)
}
