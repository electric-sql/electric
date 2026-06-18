import type { BrowserWindow } from 'electron'
import {
  createConnectionState,
  runtimeStatusForConnection,
} from '../runtime/entries'
import type { DesktopState, RuntimeEntry, ServerConfig } from '../shared/types'

export type DesktopStateDeps = {
  windows: Set<BrowserWindow>
  settings: {
    servers: Array<ServerConfig>
    workingDirectory?: string | null
    skillDirectories?: Array<string>
    pullWakeRunnerId?: string | null
  }
  state: DesktopState
  credentialsRestartPending: () => boolean
  pullWakeRunnerId: string | null
  selectedServerIdForWindow: (win: BrowserWindow | null) => string | null
  findServer: (serverId: string | null | undefined) => ServerConfig | null
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  injectDevPrincipalHeaders: (server: ServerConfig) => ServerConfig
  hasConnectedLocalRuntime: () => boolean
  updateTray: () => void
}

export function desktopStateForWindow(
  deps: DesktopStateDeps,
  win: BrowserWindow | null
): DesktopState {
  const selectedServerId = deps.selectedServerIdForWindow(win)
  const activeServer = deps.findServer(selectedServerId)
  const entry = activeServer ? deps.ensureRuntimeEntry(activeServer) : null
  return {
    servers: deps.settings.servers,
    selectedServerId,
    connections: deps.settings.servers.map((server) =>
      createConnectionState(deps.ensureRuntimeEntry(server))
    ),
    runtimeStatus: runtimeStatusForConnection(entry),
    runtimeUrl: entry?.runtimeUrl ?? null,
    activeServer: activeServer
      ? deps.injectDevPrincipalHeaders(activeServer)
      : null,
    workingDirectory: deps.settings.workingDirectory ?? null,
    skillDirectories: deps.settings.skillDirectories ?? [],
    error: entry?.lastError ?? null,
    discoveredServers: deps.state.discoveredServers,
    pullWakeRunnerId:
      deps.pullWakeRunnerId ?? deps.settings.pullWakeRunnerId ?? null,
    credentialsRestartPending:
      deps.credentialsRestartPending() && deps.hasConnectedLocalRuntime(),
  }
}

export function broadcastState(deps: DesktopStateDeps): void {
  for (const win of deps.windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        `desktop:state-changed`,
        desktopStateForWindow(deps, win)
      )
    }
  }
}

export function setState(
  deps: DesktopStateDeps,
  patch: Partial<DesktopState>
): void {
  Object.assign(deps.state, patch)
  deps.updateTray()
  broadcastState(deps)
}

export function refreshDesktopState(deps: DesktopStateDeps): void {
  Object.assign(deps.state, desktopStateForWindow(deps, null))
  deps.updateTray()
  broadcastState(deps)
}
