import { registerCloudIpcHandlers } from './cloud'
import { registerChromeIpcHandlers } from './chrome'
import { registerCliIpcHandlers } from './cli'
import { registerCredentialsIpcHandlers } from './credentials'
import { registerMcpIpcHandlers } from './mcp'
import { registerPreferencesIpcHandlers } from './preferences'
import { registerRuntimeIpcHandlers } from './runtime'
import { registerServerIpcHandlers } from './servers'
import type { CloudIpcDeps } from './cloud'
import type { ChromeIpcDeps } from './chrome'
import type { CliIpcDeps } from './cli'
import type { CredentialsIpcDeps } from './credentials'
import type { McpIpcDeps } from './mcp'
import type { PreferencesIpcDeps } from './preferences'
import type { RuntimeIpcDeps } from './runtime'
import type { ServerIpcDeps } from './servers'

export type RegisterDesktopIpcDeps = ServerIpcDeps &
  RuntimeIpcDeps &
  CliIpcDeps &
  CredentialsIpcDeps &
  CloudIpcDeps &
  McpIpcDeps &
  PreferencesIpcDeps &
  ChromeIpcDeps

export function registerIpcHandlers(deps: RegisterDesktopIpcDeps): void {
  registerServerIpcHandlers(deps)
  registerRuntimeIpcHandlers(deps)
  registerCliIpcHandlers(deps)
  registerCredentialsIpcHandlers(deps)
  registerCloudIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerPreferencesIpcHandlers(deps)
  registerChromeIpcHandlers(deps)
}
