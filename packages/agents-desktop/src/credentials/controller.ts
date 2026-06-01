import { dialog } from 'electron'
import * as ApiKeyCredentials from './api-keys'
import * as CodexAuth from './codex-auth'
import type { SecretStore } from '../services/secret-store'
import type {
  ApiKeys,
  ApiKeysStatus,
  CodexAuthSource,
  CodexStatus,
  DesktopSettings,
  OnboardingState,
} from '../shared/types'

export type CredentialsController = ReturnType<
  typeof createCredentialsController
>

export function createCredentialsController(deps: {
  settings: DesktopSettings
  apiKeys: ApiKeys
  launchEnv: ApiKeys
  getSecretStore: () => SecretStore
  saveSettings: () => Promise<void>
  hasConnectedLocalRuntime: () => boolean
  setCredentialsRestartPending: (value: boolean) => void
  getCloudAuthStatus: () => string | undefined
  setWorkingDirectoryState: (workingDirectory: string | null) => void
  restartRuntime: (serverId?: string | null) => Promise<void>
}) {
  const markCredentialsDirty = (): void => {
    if (!deps.hasConnectedLocalRuntime()) return
    deps.setCredentialsRestartPending(true)
  }

  const codexAuthDeps: CodexAuth.CodexAuthDeps = {
    settings: deps.settings,
    getSecretStore: deps.getSecretStore,
    saveSettings: deps.saveSettings,
    markCredentialsDirty,
  }

  const getCodexStatus = (): Promise<CodexStatus> =>
    CodexAuth.getCodexStatus(codexAuthDeps)

  return {
    syncCodexEnvironment: () => CodexAuth.syncCodexEnvironment(codexAuthDeps),
    getCodexStatus,
    enableCodexSource: (source: CodexAuthSource) =>
      CodexAuth.enableCodexSource(codexAuthDeps, source),
    disableCodex: () => CodexAuth.disableCodex(codexAuthDeps),
    signInCodex: () => CodexAuth.signInCodex(codexAuthDeps),
    applyApiKeys: () =>
      ApiKeyCredentials.applyApiKeysToEnv(
        deps.apiKeys,
        deps.launchEnv,
        process.env
      ),
    getApiKeysStatus: (): Promise<ApiKeysStatus> =>
      ApiKeyCredentials.getApiKeysStatus({
        apiKeys: deps.apiKeys,
        launchEnv: deps.launchEnv,
        getCodexStatus,
      }),
    setApiKeys: (next: ApiKeys): Promise<void> =>
      ApiKeyCredentials.setApiKeys(
        {
          apiKeys: deps.apiKeys,
          apiKeysRef: () => deps.settings.apiKeysRef,
          secretStore: deps.getSecretStore(),
          launchEnv: deps.launchEnv,
          saveSettings: deps.saveSettings,
          markCredentialsDirty,
          env: process.env,
        },
        next
      ),
    getOnboardingState: (): OnboardingState => ({
      dismissed: deps.settings.onboardingDismissed === true,
      hasAnyKey: Boolean(
        deps.apiKeys.anthropic ||
          deps.apiKeys.openai ||
          deps.apiKeys.deepseek ||
          deps.apiKeys.moonshot ||
          deps.settings.codex?.enabled
      ),
      signedIn: deps.getCloudAuthStatus() === `signed-in`,
    }),
    setOnboardingDismissed: async (dismissed: boolean): Promise<void> => {
      deps.settings.onboardingDismissed = dismissed
      await deps.saveSettings()
    },
    chooseWorkingDirectory: async (): Promise<string | null | undefined> => {
      const result = await dialog.showOpenDialog({
        properties: [`openDirectory`, `createDirectory`],
      })
      if (result.canceled) return deps.settings.workingDirectory
      deps.settings.workingDirectory = result.filePaths[0] ?? null
      deps.setWorkingDirectoryState(deps.settings.workingDirectory)
      await deps.saveSettings()
      await Promise.all(
        deps.settings.servers
          .filter((server) => server.desiredState === `connected`)
          .map((server) => deps.restartRuntime(server.id))
      )
      return deps.settings.workingDirectory
    },
  }
}
