import { BrowserWindow, ipcMain } from 'electron'
import { normalizeServers } from '../settings/servers'
import type {
  DesktopState,
  OpenSessionPayload,
  RuntimeEntry,
  ServerConfig,
} from '../shared/types'

export type ServerIpcDeps = {
  settings: {
    servers: Array<ServerConfig>
    defaultServerId: string | null
  }
  runtimeEntries: Map<string, RuntimeEntry>
  findServer: (serverId: string | null | undefined) => ServerConfig | null
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  saveSettings: () => Promise<void>
  refreshDesktopState: () => void
  desktopStateForWindow: (win: BrowserWindow | null) => DesktopState
  desktopServerFetch: (request: unknown) => Promise<unknown>
  setActiveServer: (
    win: BrowserWindow | null,
    server: ServerConfig | null
  ) => Promise<void>
  setSelectedServerForWindow: (
    win: BrowserWindow | null,
    serverId: string | null
  ) => Promise<void>
  stopRuntimeEntry: (entry: RuntimeEntry) => Promise<void>
  restartRuntime: (serverId?: string | null) => Promise<void>
  /**
   * Returns and clears any open-session deep link captured before the
   * renderer was ready (cold start). The renderer pulls this on mount — see
   * the `desktop:get-pending-session` handler.
   */
  takePendingOpenSession: () => OpenSessionPayload | null
}

export function registerServerIpcHandlers(deps: ServerIpcDeps): void {
  ipcMain.handle(`desktop:get-servers`, () => deps.settings.servers)
  ipcMain.handle(
    `desktop:save-servers`,
    async (_event, servers: Array<ServerConfig>) => {
      const previous = new Map(deps.settings.servers.map((s) => [s.url, s]))
      deps.settings.servers = normalizeServers(servers).map((server) => ({
        ...server,
        desiredState:
          previous.get(server.url)?.desiredState ?? server.desiredState,
      }))
      for (const server of deps.settings.servers) {
        const entry = deps.ensureRuntimeEntry(server)
        if (!server.localRuntimeEnabled && entry.runtime) {
          await deps.stopRuntimeEntry(entry)
          entry.localRuntimeStatus = `disabled`
          if (server.desiredState === `connected`) {
            entry.status = `connected`
            entry.lastError = null
            entry.lastConnectedAt = Date.now()
          }
        } else if (server.localRuntimeEnabled && entry.status === `connected`) {
          void deps.restartRuntime(server.id)
        }
      }
      const liveIds = new Set(deps.settings.servers.map((server) => server.id))
      for (const [id, entry] of deps.runtimeEntries) {
        if (!liveIds.has(id)) {
          await deps.stopRuntimeEntry(entry)
          deps.runtimeEntries.delete(id)
        }
      }
      if (!deps.findServer(deps.settings.defaultServerId)) {
        deps.settings.defaultServerId = deps.settings.servers[0]?.id ?? null
      }
      await deps.saveSettings()
      deps.refreshDesktopState()
    }
  )
  ipcMain.handle(`desktop:get-state`, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return deps.desktopStateForWindow(win)
  })
  ipcMain.handle(`desktop:server-fetch`, (_event, request: unknown) =>
    deps.desktopServerFetch(request)
  )
  ipcMain.handle(
    `desktop:set-active-server`,
    async (_event, server: ServerConfig | null) => {
      const win = BrowserWindow.fromWebContents(_event.sender)
      await deps.setActiveServer(win, server)
    }
  )
  ipcMain.handle(`desktop:set-selected-server`, async (event, serverId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await deps.setSelectedServerForWindow(
      win,
      typeof serverId === `string` ? serverId : null
    )
  })
  ipcMain.handle(`desktop:get-pending-session`, () =>
    deps.takePendingOpenSession()
  )
}
