import { registerCloudIpcHandlers } from './cloud'
import { registerChromeIpcHandlers } from './chrome'
import { registerCredentialsIpcHandlers } from './credentials'
import { registerMcpIpcHandlers } from './mcp'
import { registerRuntimeIpcHandlers } from './runtime'
import { registerServerIpcHandlers } from './servers'
import type { CloudIpcDeps } from './cloud'
import type { DesktopIpcDeps } from './types'

export type RegisterDesktopIpcDeps = DesktopIpcDeps & CloudIpcDeps

export function registerIpcHandlers(deps: RegisterDesktopIpcDeps): void {
  registerServerIpcHandlers(deps)
  registerRuntimeIpcHandlers(deps)
  registerCredentialsIpcHandlers(deps)
  registerCloudIpcHandlers(deps)
  registerMcpIpcHandlers(deps)
  registerChromeIpcHandlers(deps)
}
