import { BrowserWindow, ipcMain } from 'electron'
import type { ConnectServerOptions } from '../shared/types'
import type { DesktopIpcDeps } from './types'

export function registerRuntimeIpcHandlers(deps: DesktopIpcDeps): void {
  ipcMain.handle(
    `desktop:connect-server`,
    async (_event, serverId, options?: ConnectServerOptions) => {
      if (typeof serverId === `string`)
        await deps.connectServer(serverId, options)
    }
  )
  ipcMain.handle(`desktop:disconnect-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await deps.disconnectServer(serverId)
  })
  ipcMain.handle(`desktop:forget-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await deps.forgetServer(serverId)
  })
  ipcMain.handle(
    `desktop:restart-runtime`,
    async (event, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      await deps.restartRuntime(
        typeof serverId === `string`
          ? serverId
          : deps.selectedServerIdForWindow(win)
      )
    }
  )
  ipcMain.handle(`desktop:stop-runtime`, async (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await deps.stopRuntime(
      typeof serverId === `string`
        ? serverId
        : deps.selectedServerIdForWindow(win)
    )
  })
  ipcMain.handle(`desktop:rescan-servers`, async () => {
    await deps.runDiscovery()
    return deps.state.discoveredServers
  })
}
