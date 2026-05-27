import { BrowserWindow, ipcMain } from 'electron'
import {
  authorizeMcpServer,
  disableMcpServer,
  enableMcpServer,
  getMcpSnapshot,
  reconnectMcpServer,
} from '../runtime/mcp'
import type { RegistrySnapshot, RuntimeEntry } from '../shared/types'

export type McpIpcDeps = {
  runtimeEntries: Map<string, RuntimeEntry>
  lastMcpSnapshots: Map<string, RegistrySnapshot>
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
}
