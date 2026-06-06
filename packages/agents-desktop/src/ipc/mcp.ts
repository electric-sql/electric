import { BrowserWindow, ipcMain } from 'electron'
import {
  authorizeMcpServer,
  disableMcpServer,
  enableMcpServer,
  getMcpSnapshot,
  reconnectMcpServer,
  removeMcpServer,
  upsertMcpServer,
} from '../runtime/mcp'
import type {
  DesktopMcpSnapshot,
  DesktopSettings,
  McpServerConfig,
  RuntimeEntry,
} from '../shared/types'

export type McpIpcDeps = {
  settings: DesktopSettings
  saveSettings: () => Promise<void>
  runtimeEntries: Map<string, RuntimeEntry>
  lastMcpSnapshots: Map<string, DesktopMcpSnapshot>
  windows: Set<BrowserWindow>
  selectedServerIdForWindow: (win: BrowserWindow | null) => string | null
}

export function registerMcpIpcHandlers(deps: McpIpcDeps): void {
  ipcMain.handle(`desktop:mcp-snapshot`, (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const id =
      typeof serverId === `string`
        ? serverId
        : deps.selectedServerIdForWindow(win)
    return getMcpSnapshot(deps.lastMcpSnapshots, id)
  })
  ipcMain.handle(
    `desktop:mcp-authorize`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string`
          ? serverId
          : deps.selectedServerIdForWindow(win)
      await authorizeMcpServer(deps.runtimeEntries, id, name)
    }
  )
  ipcMain.handle(
    `desktop:mcp-reconnect`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string`
          ? serverId
          : deps.selectedServerIdForWindow(win)
      await reconnectMcpServer(deps.runtimeEntries, id, name)
    }
  )
  ipcMain.handle(
    `desktop:mcp-disable`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string`
          ? serverId
          : deps.selectedServerIdForWindow(win)
      await disableMcpServer(deps.runtimeEntries, id, name)
    }
  )
  ipcMain.handle(
    `desktop:mcp-enable`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string`
          ? serverId
          : deps.selectedServerIdForWindow(win)
      await enableMcpServer(deps.runtimeEntries, id, name)
    }
  )
  // Add/Edit and Remove operate on the global settings.json `mcp.servers`
  // block. The runtimeEntries / snapshot args from per-server callers are
  // ignored here because settings.json is shared across every connected
  // runtime — every live runtime gets the new extras pushed at once.
  ipcMain.handle(`desktop:mcp-upsert`, async (_event, cfg: McpServerConfig) => {
    await upsertMcpServer({
      settings: deps.settings,
      saveSettings: deps.saveSettings,
      runtimeEntries: deps.runtimeEntries,
      snapshots: deps.lastMcpSnapshots,
      windows: deps.windows,
      cfg,
    })
  })
  ipcMain.handle(`desktop:mcp-remove`, async (_event, name: string) => {
    await removeMcpServer({
      settings: deps.settings,
      saveSettings: deps.saveSettings,
      runtimeEntries: deps.runtimeEntries,
      snapshots: deps.lastMcpSnapshots,
      windows: deps.windows,
      name,
    })
  })
}
