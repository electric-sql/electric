import { ipcMain } from 'electron'
import type { ElectricCliStatus } from '../shared/types'

export type CliIpcDeps = {
  getCliStatus: () => Promise<ElectricCliStatus>
  installCli: () => Promise<ElectricCliStatus>
  uninstallCli: () => Promise<ElectricCliStatus>
}

export function registerCliIpcHandlers(deps: CliIpcDeps): void {
  ipcMain.handle(`desktop:get-cli-status`, () => deps.getCliStatus())
  ipcMain.handle(`desktop:install-cli`, () => deps.installCli())
  ipcMain.handle(`desktop:uninstall-cli`, () => deps.uninstallCli())
}
