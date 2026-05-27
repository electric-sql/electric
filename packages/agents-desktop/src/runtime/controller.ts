import { BrowserWindow } from 'electron'
import * as RuntimeLifecycle from './lifecycle'
import * as McpRuntime from './mcp'
import { MCP_OAUTH_REDIRECT_BASE } from '../shared/constants'
import type { CloudAgentServers } from '../cloud/cloud-agent-servers'
import type { CloudAuthState } from '../cloud/cloud-auth'
import type {
  ConnectServerOptions,
  DesktopSettings,
  DesktopState,
  RegistrySnapshot,
  RuntimeEntry,
  ServerConfig,
} from '../shared/types'

export type RuntimeController = ReturnType<typeof createRuntimeController>

export function createRuntimeController(deps: {
  settings: DesktopSettings
  runtimeEntries: Map<string, RuntimeEntry>
  windowSelections: Map<number, string | null>
  windows: Set<BrowserWindow>
  lastMcpSnapshots: Map<string, RegistrySnapshot>
  findServer: (serverId: string | null | undefined) => ServerConfig | null
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  saveSettings: () => Promise<void>
  refreshDesktopState: () => void
  setState: (patch: Partial<DesktopState>) => void
  setCredentialsRestartPending: (value: boolean) => void
  injectDevPrincipalHeaders: (server: ServerConfig) => ServerConfig
  configureRuntimeEnvironment: () => void
  applyApiKeys: () => void
  syncCodexEnvironment: () => Promise<void>
  getCloudAgentServers: () => CloudAgentServers
  getCloudAuthState: () => CloudAuthState | undefined
  selectedServerIdForWindow: (win: BrowserWindow | null) => string | null
}) {
  const broadcastMcpSnapshot = (
    serverId: string,
    snapshot: RegistrySnapshot
  ): void => {
    McpRuntime.broadcastMcpSnapshot(
      { snapshots: deps.lastMcpSnapshots, windows: deps.windows },
      serverId,
      snapshot
    )
  }

  const handleAuthorizeUrl = async (
    serverId: string,
    url: string,
    server: string
  ): Promise<void> => {
    await McpRuntime.handleAuthorizeUrl({
      runtimeEntries: deps.runtimeEntries,
      redirectBase: MCP_OAUTH_REDIRECT_BASE,
      serverId,
      url,
      server,
    })
  }

  const lifecycleDeps: RuntimeLifecycle.RuntimeLifecycleDeps = {
    settings: deps.settings,
    runtimeEntries: deps.runtimeEntries,
    windowSelections: deps.windowSelections,
    findServer: deps.findServer,
    ensureRuntimeEntry: deps.ensureRuntimeEntry,
    saveSettings: deps.saveSettings,
    refreshDesktopState: deps.refreshDesktopState,
    setState: deps.setState,
    setCredentialsRestartPending: deps.setCredentialsRestartPending,
    injectDevPrincipalHeaders: deps.injectDevPrincipalHeaders,
    configureRuntimeEnvironment: deps.configureRuntimeEnvironment,
    applyApiKeys: deps.applyApiKeys,
    syncCodexEnvironment: deps.syncCodexEnvironment,
    broadcastMcpSnapshot,
    handleAuthorizeUrl,
    getCloudAgentServers: deps.getCloudAgentServers,
    getCloudAuthState: deps.getCloudAuthState,
  }

  const selectedOrDefaultServerId = (serverId?: string | null): string | null =>
    serverId ??
    deps.selectedServerIdForWindow(BrowserWindow.getFocusedWindow()) ??
    deps.settings.defaultServerId

  return {
    lifecycleDeps,
    hasConnectedLocalRuntime: () =>
      RuntimeLifecycle.hasConnectedLocalRuntime(lifecycleDeps),
    restartConnectedRuntimes: () =>
      RuntimeLifecycle.restartConnectedRuntimes(lifecycleDeps),
    stopExistingRuntime: () =>
      RuntimeLifecycle.stopExistingRuntime(lifecycleDeps),
    stopRuntimeEntry: (entry: RuntimeEntry) =>
      RuntimeLifecycle.stopRuntimeEntry(lifecycleDeps, entry),
    connectServer: (serverId: string, options: ConnectServerOptions = {}) =>
      RuntimeLifecycle.connectServer(lifecycleDeps, serverId, options),
    disconnectServer: (serverId: string) =>
      RuntimeLifecycle.disconnectServer(lifecycleDeps, serverId),
    forgetServer: (serverId: string) =>
      RuntimeLifecycle.forgetServer(lifecycleDeps, serverId),
    restartRuntime: (serverId?: string | null) =>
      RuntimeLifecycle.restartRuntime(
        lifecycleDeps,
        selectedOrDefaultServerId(serverId)
      ),
    stopRuntime: (serverId?: string | null) =>
      RuntimeLifecycle.stopRuntime(
        lifecycleDeps,
        selectedOrDefaultServerId(serverId)
      ),
  }
}
