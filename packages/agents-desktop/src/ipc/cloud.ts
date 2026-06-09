import { BrowserWindow, ipcMain } from 'electron'
import type { CloudAgentServers } from '../cloud/cloud-agent-servers'
import type { CloudAuth, CloudAuthProvider } from '../cloud/cloud-auth'
import type { ServerConfig } from '../shared/types'

export type CloudIpcDeps = {
  settings: {
    servers: Array<ServerConfig>
  }
  getCloudAuth: () => CloudAuth
  getCloudAgentServers: () => CloudAgentServers
  forgetServer: (serverId: string) => Promise<void>
}

export function registerCloudIpcHandlers(deps: CloudIpcDeps): void {
  ipcMain.handle(`desktop:cloud-auth-state`, () =>
    deps.getCloudAuth().getState()
  )
  ipcMain.handle(
    `desktop:cloud-auth-sign-in`,
    async (event, provider: CloudAuthProvider) => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      await deps.getCloudAuth().signIn(provider, parent)
    }
  )
  ipcMain.handle(`desktop:cloud-auth-sign-out`, async () => {
    await deps.getCloudAuth().signOut()
    const cloudServerIds = deps.settings.servers
      .filter((server) => server.source === `electric-cloud`)
      .map((server) => server.id)
    for (const serverId of cloudServerIds) {
      await deps.forgetServer(serverId)
    }
  })
  ipcMain.handle(`desktop:cloud-auth-open-dashboard`, () => {
    deps.getCloudAuth().openDashboard()
  })
  ipcMain.handle(`desktop:cloud-auth-open-create-agents-server`, () => {
    deps.getCloudAuth().openCreateAgentsServer()
  })

  ipcMain.handle(`desktop:cloud-agent-servers-state`, () =>
    deps.getCloudAgentServers().getState()
  )
  ipcMain.handle(
    `desktop:cloud-agent-server-prepare-connection`,
    async (_event, tenantId: string) => {
      return await deps.getCloudAgentServers().prepareConnection(tenantId)
    }
  )
}
