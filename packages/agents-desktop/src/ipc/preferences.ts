import { ipcMain } from 'electron'
import type { LaunchAtLoginStatus } from '../shared/types'

export type PreferencesIpcDeps = {
  getLaunchAtLoginStatus: () => Promise<LaunchAtLoginStatus>
  setLaunchAtLogin: (enabled: boolean) => Promise<LaunchAtLoginStatus>
}

export function registerPreferencesIpcHandlers(deps: PreferencesIpcDeps): void {
  ipcMain.handle(`desktop:get-launch-at-login`, () =>
    deps.getLaunchAtLoginStatus()
  )
  ipcMain.handle(`desktop:set-launch-at-login`, (_event, enabled: boolean) =>
    deps.setLaunchAtLogin(Boolean(enabled))
  )
}
