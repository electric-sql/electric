import { BrowserWindow } from 'electron'
import type { DesktopAppContext } from './context'
import * as AppLifecycle from './lifecycle'
import * as LoginItems from './login-items'
import { createDesktopUpdater } from './updater'
import * as CloudAuthInjection from '../cloud/auth-injection'
import * as ServerFetch from '../cloud/server-fetch'
import { createCredentialsController } from '../credentials/controller'
import { createLocalDiscoveryLoop } from '../discovery/local-discovery'
import * as DesktopIpc from '../ipc/register'
import { ensureRuntimeEntry as ensureRuntimeEntryInStore } from '../runtime/entries'
import { createRuntimeController } from '../runtime/controller'
import * as SettingsBootstrap from '../settings/bootstrap'
import * as ServerSelection from '../settings/selection'
import { saveDesktopSettings } from '../settings/store'
import { desktopStateForWindow as desktopStateForWindowImpl } from '../state/desktop-state'
import * as DesktopStateModel from '../state/desktop-state'
import { injectDevPrincipalHeaders as injectDevPrincipalHeadersForServer } from '../shared/headers'
import {
  DEFAULT_LOCAL_DEV_PRINCIPAL,
  EXTERNAL_LINK_PROTOCOLS,
  PULL_WAKE_RUNNER_ID,
  explicitDevPrincipalFromEnv,
} from '../shared/constants'
import type {
  ConnectServerOptions,
  DesktopAppearance,
  DesktopCommand,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopState,
  RuntimeEntry,
  ServerConfig,
} from '../shared/types'
import * as AboutDialog from '../ui/about-dialog'
import * as ApplicationMenu from '../ui/application-menu'
import * as Tray from '../ui/tray'
import {
  installNavigationStateBridge,
  sendFullscreenState,
} from '../windows/navigation'
import {
  installEditableContextMenu,
  installExternalLinkHandler,
  showSelectionContextMenu,
} from '../windows/context-menu'
import * as WindowManager from '../windows/manager'
import { TRAY_ICON_2X_PATH, TRAY_ICON_PATH } from '../shared/paths'
import type { CloudAgentServersState } from '../cloud/cloud-agent-servers'
import type { CloudAuthState } from '../cloud/cloud-auth'

export type DesktopMainController = ReturnType<
  typeof createDesktopMainController
>

export function createDesktopMainController(ctx: DesktopAppContext) {
  const settings = ctx.settings
  const apiKeys = ctx.apiKeys
  const state = ctx.state
  const windows = ctx.windows
  const windowSelections = ctx.windowSelections
  const runtimeEntries = ctx.runtimeEntries
  const lastMcpSnapshots = ctx.lastMcpSnapshots
  const explicitDevPrincipal = explicitDevPrincipalFromEnv()

  const saveSettings = async (): Promise<void> => {
    await saveDesktopSettings(settings)
  }

  const ensureRuntimeEntry = (server: ServerConfig): RuntimeEntry =>
    ensureRuntimeEntryInStore(runtimeEntries, server)

  const serverSelectionDeps: ServerSelection.ServerSelectionDeps = {
    settings,
    windowSelections,
    saveSettings,
    refreshDesktopState,
  }

  const findServer = (
    serverId: string | null | undefined
  ): ServerConfig | null =>
    ServerSelection.findServer(serverSelectionDeps, serverId)

  const defaultSelectedServerId = (): string | null =>
    ServerSelection.defaultSelectedServerId(serverSelectionDeps)

  const selectedServerIdForWindow = (
    win: BrowserWindow | null
  ): string | null =>
    ServerSelection.selectedServerIdForWindow(serverSelectionDeps, win)

  const injectDevPrincipalHeaders = (server: ServerConfig): ServerConfig =>
    injectDevPrincipalHeadersForServer(server, {
      explicitDevPrincipal,
      defaultLocalDevPrincipal: DEFAULT_LOCAL_DEV_PRINCIPAL,
    })

  const cloudAuthHeaderInjectionDeps: CloudAuthInjection.CloudAuthHeaderInjectionDeps =
    {
      getServers: () => settings.servers,
      getAgentsToken: (tenantId) =>
        ctx.services.cloudAgentServers?.getAgentsToken(tenantId),
      getCloudAuthState: () => ctx.services.cloudAuth?.getState(),
      injectDevPrincipalHeaders,
    }

  const desktopStateDeps: DesktopStateModel.DesktopStateDeps = {
    windows,
    settings,
    state,
    credentialsRestartPending: () => ctx.credentialsRestartPending,
    pullWakeRunnerId: PULL_WAKE_RUNNER_ID,
    selectedServerIdForWindow,
    findServer,
    ensureRuntimeEntry,
    injectDevPrincipalHeaders,
    hasConnectedLocalRuntime,
    updateTray,
  }

  const desktopStateForWindow = (win: BrowserWindow | null): DesktopState =>
    desktopStateForWindowImpl(desktopStateDeps, win)

  const setState = (patch: Partial<DesktopState>): void => {
    DesktopStateModel.setState(desktopStateDeps, patch)
  }

  function refreshDesktopState(): void {
    DesktopStateModel.refreshDesktopState(desktopStateDeps)
  }

  const setCredentialsRestartPending = (value: boolean): void => {
    if (ctx.credentialsRestartPending === value) return
    ctx.credentialsRestartPending = value
    refreshDesktopState()
  }

  const credentials = createCredentialsController({
    settings,
    apiKeys,
    launchEnv: ctx.envApiKeysSnapshot,
    getSecretStore: ctx.getSecretStore,
    saveSettings,
    hasConnectedLocalRuntime,
    setCredentialsRestartPending,
    getCloudAuthStatus: () => ctx.services.cloudAuth?.getState().status,
    setWorkingDirectoryState: (workingDirectory) =>
      setState({ workingDirectory }),
    restartRuntime: (serverId) => runtime.restartRuntime(serverId),
  })

  const runtime = createRuntimeController({
    settings,
    runtimeEntries,
    windowSelections,
    windows,
    lastMcpSnapshots,
    findServer,
    ensureRuntimeEntry,
    saveSettings,
    refreshDesktopState,
    setState,
    setCredentialsRestartPending,
    injectDevPrincipalHeaders,
    configureRuntimeEnvironment: AppLifecycle.configureRuntimeEnvironment,
    applyApiKeys: credentials.applyApiKeys,
    syncCodexEnvironment: credentials.syncCodexEnvironment,
    getCloudAgentServers: ctx.getCloudAgentServers,
    getCloudAuthState: () => ctx.services.cloudAuth?.getState(),
    selectedServerIdForWindow,
  })

  function hasConnectedLocalRuntime(): boolean {
    return runtime.hasConnectedLocalRuntime()
  }

  const sendCommand = (command: DesktopCommand): void => {
    const focused = BrowserWindow.getFocusedWindow()
    const target =
      focused ?? [...windows].find((win) => !win.isDestroyed()) ?? null
    target?.webContents.send(`desktop:command`, command)
  }

  function updateTray(): void {
    Tray.updateTray({
      tray: ctx.shell.tray,
      servers: settings.servers,
      runtimeEntries,
      ensureRuntimeEntry,
      createWindow,
      sendCommand,
      connectServer,
      disconnectServer,
      saveSettings,
      preventAppSuspension: getPreventAppSuspension(),
      setPreventAppSuspension,
      stopRuntimeEntry,
      restartRuntime,
      refreshDesktopState,
      quitApp,
    })
  }

  const windowManagerDeps: WindowManager.WindowManagerDeps = {
    windows,
    windowSelections,
    defaultSelectedServerId,
    installEditableContextMenu: (win) =>
      installEditableContextMenu(EXTERNAL_LINK_PROTOCOLS, win),
    installExternalLinkHandler: (win) =>
      installExternalLinkHandler(EXTERNAL_LINK_PROTOCOLS, win),
    installNavigationStateBridge,
    sendFullscreenState,
    buildApplicationMenu,
  }

  const createWindow = (): BrowserWindow =>
    WindowManager.createWindow(windowManagerDeps)

  const showOrCreateWindow = (): void => {
    WindowManager.showOrCreateWindow(windows, createWindow)
  }

  const stopRuntimeEntry = (entry: RuntimeEntry): Promise<void> =>
    runtime.stopRuntimeEntry(entry)

  const connectServer = (
    serverId: string,
    options: ConnectServerOptions = {}
  ): Promise<void> => runtime.connectServer(serverId, options)

  const disconnectServer = (serverId: string): Promise<void> =>
    runtime.disconnectServer(serverId)

  const restartRuntime = (serverId?: string | null): Promise<void> =>
    runtime.restartRuntime(serverId)

  const stopRuntime = (serverId?: string | null): Promise<void> =>
    runtime.stopRuntime(serverId)

  const forgetServer = (serverId: string): Promise<void> =>
    runtime.forgetServer(serverId)

  const setSelectedServerForWindow = (
    win: BrowserWindow | null,
    serverId: string | null
  ): Promise<void> =>
    ServerSelection.setSelectedServerForWindow(
      serverSelectionDeps,
      win,
      serverId
    )

  const setActiveServer = (
    win: BrowserWindow | null,
    server: ServerConfig | null
  ): Promise<void> =>
    ServerSelection.setActiveServer(serverSelectionDeps, win, server)

  const localDiscovery = createLocalDiscoveryLoop({
    runtimeEntries,
    state,
    setState,
  })

  const quitApp = (): Promise<void> =>
    AppLifecycle.quitApp({
      ctx,
      stopDiscoveryLoop: localDiscovery.stopDiscoveryLoop,
      runtimeLifecycleDeps: runtime.lifecycleDeps,
    })

  const clearAllLocalDataAndRelaunch = (): Promise<void> =>
    AppLifecycle.clearAllLocalDataAndRelaunch({
      ctx,
      quitApp,
    })

  const getLaunchAtLoginStatus = () => LoginItems.getLaunchAtLoginStatus()

  const setLaunchAtLogin = async (enabled: boolean) => {
    const status = await LoginItems.setLaunchAtLogin(enabled)
    if (!status.supported) return status

    settings.launchAtLogin = enabled
    await saveSettings()
    return status
  }

  const getPreventAppSuspension = (): boolean =>
    settings.preventAppSuspension !== false

  const setPreventAppSuspension = async (enabled: boolean): Promise<void> => {
    settings.preventAppSuspension = enabled
    await saveSettings()
    runtime.refreshPowerSaveBlocker()
  }

  const syncLaunchAtLoginSetting = async (): Promise<void> => {
    await LoginItems.setLaunchAtLogin(settings.launchAtLogin === true)
  }

  const applyNativeAppearance = (appearance: DesktopAppearance): void => {
    AppLifecycle.applyNativeAppearance(ctx, appearance)
  }

  const updater = createDesktopUpdater({
    showOrCreateWindow,
  })

  const checkForUpdates = (): Promise<void> =>
    updater.checkForUpdates({ triggeredManually: true })

  const applicationMenuDeps: ApplicationMenu.ApplicationMenuDeps = {
    windows,
    createWindow,
    sendCommand,
    quitApp,
    showAboutDialog,
    checkForUpdates,
  }

  function showAboutDialog(): void {
    AboutDialog.showAboutDialog({
      getAboutWindow: () => ctx.shell.aboutWindow,
      setAboutWindow: (win) => {
        ctx.shell.aboutWindow = win
      },
    })
  }

  function buildApplicationMenu(): void {
    ApplicationMenu.buildApplicationMenu(applicationMenuDeps)
  }

  const popupApplicationMenuSection = (
    win: BrowserWindow,
    section: DesktopMenuSection,
    bounds: DesktopMenuPopupBounds,
    state: DesktopMenuState
  ): void => {
    ApplicationMenu.popupApplicationMenuSection(
      applicationMenuDeps,
      win,
      section,
      bounds,
      state
    )
  }

  const popupAppIconMenu = (
    win: BrowserWindow,
    bounds: DesktopMenuPopupBounds
  ): void => {
    ApplicationMenu.popupAppIconMenu(
      { showAboutDialog, checkForUpdates },
      win,
      bounds
    )
  }

  const desktopIpcDeps: DesktopIpc.RegisterDesktopIpcDeps = {
    settings,
    state,
    runtimeEntries,
    findServer,
    ensureRuntimeEntry,
    saveSettings,
    refreshDesktopState,
    desktopStateForWindow,
    desktopServerFetch: (request) =>
      ServerFetch.desktopServerFetch(cloudAuthHeaderInjectionDeps, request),
    setActiveServer,
    setSelectedServerForWindow,
    selectedServerIdForWindow,
    stopRuntimeEntry,
    restartRuntime,
    connectServer,
    disconnectServer,
    forgetServer,
    stopRuntime,
    runDiscovery: localDiscovery.runDiscovery,
    getApiKeysStatus: credentials.getApiKeysStatus,
    setApiKeys: credentials.setApiKeys,
    setEnabledModels: credentials.setEnabledModels,
    signInCodex: credentials.signInCodex,
    enableCodexSource: credentials.enableCodexSource,
    disableCodex: credentials.disableCodex,
    restartConnectedRuntimes: runtime.restartConnectedRuntimes,
    getCliStatus: ctx.getCli().getStatus,
    installCli: ctx.getCli().install,
    uninstallCli: ctx.getCli().uninstall,
    clearAllLocalDataAndRelaunch,
    getOnboardingState: credentials.getOnboardingState,
    setOnboardingDismissed: credentials.setOnboardingDismissed,
    chooseWorkingDirectory: credentials.chooseWorkingDirectory,
    applyNativeAppearance,
    showSelectionContextMenu,
    popupApplicationMenuSection,
    popupAppIconMenu,
    lastMcpSnapshots,
    getCloudAuth: ctx.getCloudAuth,
    getCloudAgentServers: ctx.getCloudAgentServers,
    getLaunchAtLoginStatus,
    setLaunchAtLogin,
    getPreventAppSuspension,
    setPreventAppSuspension,
  }

  const loadSettings = (): Promise<void> =>
    SettingsBootstrap.loadSettings({
      settings,
      apiKeys,
      getSecretStore: ctx.getSecretStore,
      ensureRuntimeEntry,
      state,
      desktopStateForWindow,
      applyApiKeys: credentials.applyApiKeys,
      syncCodexEnvironment: credentials.syncCodexEnvironment,
      saveSettings,
    })

  const createTray = (): void => {
    const trayIcon = Tray.createTrayIcon({
      iconPath: TRAY_ICON_PATH,
      icon2xPath: TRAY_ICON_2X_PATH,
    })
    if (trayIcon.isEmpty()) {
      console.error(
        `[agents-desktop] Tray icon failed to load from ${TRAY_ICON_PATH}; ` +
          `the menu bar item may be invisible.`
      )
    }
    ctx.shell.tray = Tray.createDesktopTray(trayIcon, () =>
      showOrCreateWindow()
    )
    updateTray()
  }

  const registerIpcHandlers = (): void => {
    DesktopIpc.registerIpcHandlers(desktopIpcDeps)
  }

  const installCloudAuthHeaderInjection = (): void => {
    CloudAuthInjection.installCloudAuthHeaderInjection(
      cloudAuthHeaderInjectionDeps
    )
  }

  const connectConfiguredServers = (): void => {
    for (const server of settings.servers) {
      if (server.desiredState === `connected`) {
        void connectServer(server.id)
      }
    }
  }

  return {
    broadcastCloudAuthState(next: CloudAuthState): void {
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(`desktop:cloud-auth-state-changed`, next)
        }
      }
    },
    broadcastCloudAgentServersState(next: CloudAgentServersState): void {
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(
            `desktop:cloud-agent-servers-state-changed`,
            next
          )
        }
      }
    },
    loadSettings,
    registerIpcHandlers,
    installCloudAuthHeaderInjection,
    createTray,
    buildApplicationMenu,
    createWindow,
    showOrCreateWindow,
    syncLaunchAtLoginSetting,
    connectConfiguredServers,
    startDiscoveryLoop: localDiscovery.startDiscoveryLoop,
    initializeUpdater: updater.initialize,
    quitApp,
  }
}
