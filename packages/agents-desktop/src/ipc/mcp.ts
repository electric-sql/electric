import { BrowserWindow, ipcMain } from 'electron'
import type { DesktopIpcDeps } from './types'

export function registerMcpIpcHandlers(deps: DesktopIpcDeps): void {
  ipcMain.handle(`desktop:mcp-snapshot`, (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const id =
      typeof serverId === `string`
        ? serverId
        : deps.selectedServerIdForWindow(win)
    return deps.getMcpSnapshot(id)
  })
  ipcMain.handle(
    `desktop:mcp-authorize`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string`
          ? serverId
          : deps.selectedServerIdForWindow(win)
      await deps.authorizeMcpServer(id, name)
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
      await deps.reconnectMcpServer(id, name)
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
      await deps.disableMcpServer(id, name)
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
      await deps.enableMcpServer(id, name)
    }
  )
}
