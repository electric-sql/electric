import { ipcMain } from 'electron'
import type {
  LaunchAtLoginStatus,
  PreventAppSuspensionPreference,
} from '../shared/types'

export type PreferencesIpcDeps = {
  getLaunchAtLoginStatus: () => Promise<LaunchAtLoginStatus>
  setLaunchAtLogin: (enabled: boolean) => Promise<LaunchAtLoginStatus>
  getPreventAppSuspension: () => PreventAppSuspensionPreference
  setPreventAppSuspension: (enabled: boolean) => Promise<void>
}

export function registerPreferencesIpcHandlers(deps: PreferencesIpcDeps): void {
  ipcMain.handle(`desktop:get-launch-at-login`, () =>
    deps.getLaunchAtLoginStatus()
  )
  ipcMain.handle(`desktop:set-launch-at-login`, (_event, enabled: boolean) =>
    deps.setLaunchAtLogin(Boolean(enabled))
  )
  ipcMain.handle(
    `desktop:get-prevent-app-suspension`,
    () => deps.getPreventAppSuspension()
  )
  ipcMain.handle(
    `desktop:set-prevent-app-suspension`,
    (_event, enabled: boolean) => deps.setPreventAppSuspension(Boolean(enabled))
  )
}
