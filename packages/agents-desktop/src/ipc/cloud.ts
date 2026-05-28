import { BrowserWindow, ipcMain } from 'electron'
import type { CloudAgentServers } from '../cloud/cloud-agent-servers'
import type { CloudAuth, CloudAuthProvider } from '../cloud/cloud-auth'

export type CloudIpcDeps = {
  getCloudAuth: () => CloudAuth
  getCloudAgentServers: () => CloudAgentServers
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
