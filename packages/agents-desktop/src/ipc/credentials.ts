import { dialog, ipcMain } from 'electron'
import type {
  ApiKeys,
  CodexAuthSource,
  OnboardingState,
  ServerConfig,
} from '../shared/types'

export type CredentialsIpcDeps = {
  settings: {
    servers: Array<ServerConfig>
    workingDirectory?: string | null
  }
  getApiKeysStatus: () => Promise<unknown>
  setApiKeys: (keys: ApiKeys) => Promise<void>
  signInCodex: () => Promise<unknown>
  enableCodexSource: (source: CodexAuthSource) => Promise<unknown>
  disableCodex: () => Promise<unknown>
  restartConnectedRuntimes: () => Promise<void>
  clearAllLocalDataAndRelaunch: () => Promise<void>
  getOnboardingState: () => OnboardingState
  setOnboardingDismissed: (dismissed: boolean) => Promise<void>
  chooseWorkingDirectory: () => Promise<string | null | undefined>
}

export function registerCredentialsIpcHandlers(deps: CredentialsIpcDeps): void {
  ipcMain.handle(`desktop:get-api-keys-status`, () => deps.getApiKeysStatus())
  ipcMain.handle(`desktop:save-api-keys`, async (_event, keys: ApiKeys) => {
    await deps.setApiKeys(keys)
  })
  ipcMain.handle(`desktop:codex-sign-in`, () => deps.signInCodex())
  ipcMain.handle(
    `desktop:codex-enable-source`,
    (_event, source: CodexAuthSource) => deps.enableCodexSource(source)
  )
  ipcMain.handle(`desktop:codex-disable`, () => deps.disableCodex())
  ipcMain.handle(`desktop:restart-local-runtimes`, async () => {
    await deps.restartConnectedRuntimes()
  })
  ipcMain.handle(`desktop:clear-all-local-data`, async () => {
    await deps.clearAllLocalDataAndRelaunch()
  })
  ipcMain.handle(`desktop:get-onboarding-state`, () =>
    deps.getOnboardingState()
  )
  ipcMain.handle(
    `desktop:set-onboarding-dismissed`,
    async (_event, dismissed: boolean) => {
      await deps.setOnboardingDismissed(Boolean(dismissed))
    }
  )
  ipcMain.handle(
    `desktop:get-working-directory`,
    () => deps.settings.workingDirectory
  )
  ipcMain.handle(`desktop:choose-working-directory`, () =>
    deps.chooseWorkingDirectory()
  )
  ipcMain.handle(
    `desktop:pick-directory`,
    async (_event, options?: { defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: [`openDirectory`, `createDirectory`],
        defaultPath: options?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    }
  )
}
