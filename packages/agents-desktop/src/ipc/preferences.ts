import { ipcMain } from 'electron'
import type {
  LaunchAtLoginStatus,
  PreventAppSuspensionPreference,
  RealtimeSettings,
  RealtimeSettingsStatus,
} from '../shared/types'

export type PreferencesIpcDeps = {
  getLaunchAtLoginStatus: () => Promise<LaunchAtLoginStatus>
  setLaunchAtLogin: (enabled: boolean) => Promise<LaunchAtLoginStatus>
  getPreventAppSuspension: () => PreventAppSuspensionPreference
  setPreventAppSuspension: (enabled: boolean) => Promise<void>
  getRealtimeSettingsStatus: () =>
    | RealtimeSettingsStatus
    | Promise<RealtimeSettingsStatus>
  setRealtimeSettings: (settings: RealtimeSettings) => Promise<void>
}

export function registerPreferencesIpcHandlers(deps: PreferencesIpcDeps): void {
  ipcMain.handle(`desktop:get-launch-at-login`, () =>
    deps.getLaunchAtLoginStatus()
  )
  ipcMain.handle(`desktop:set-launch-at-login`, (_event, enabled: boolean) =>
    deps.setLaunchAtLogin(Boolean(enabled))
  )
  ipcMain.handle(`desktop:get-prevent-app-suspension`, () =>
    deps.getPreventAppSuspension()
  )
  ipcMain.handle(
    `desktop:set-prevent-app-suspension`,
    (_event, enabled: boolean) => deps.setPreventAppSuspension(Boolean(enabled))
  )
  ipcMain.handle(`desktop:get-realtime-settings`, () =>
    deps.getRealtimeSettingsStatus()
  )
  ipcMain.handle(
    `desktop:set-realtime-settings`,
    (_event, settings: RealtimeSettings) => deps.setRealtimeSettings(settings)
  )
}
