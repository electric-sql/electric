import { createDesktopAppContext } from './app/context'
import {
  buildSavedServerHeaders,
  installCloudAuthHeaderInjection as installCloudAuthHeaderInjectionForDeps,
  type CloudAuthHeaderInjectionDeps,
} from './cloud/auth-injection'
import {
  desktopServerFetch as desktopServerFetchForDeps,
  type DesktopServerFetchDeps,
} from './cloud/server-fetch'
import {
  applyApiKeysToEnv,
  getApiKeysStatus as getApiKeysStatusForDeps,
  setApiKeys as setApiKeysForDeps,
} from './credentials/api-keys'
import {
  disableCodex as disableCodexForDeps,
  enableCodexSource as enableCodexSourceForDeps,
  getCodexStatus as getCodexStatusForDeps,
  signInCodex as signInCodexForDeps,
  syncCodexEnvironment as syncCodexEnvironmentForDeps,
  type CodexAuthDeps,
} from './credentials/codex-auth'
import { ensureRuntimeEntry as ensureRuntimeEntryInStore } from './runtime/entries'
import { createLocalDiscoveryLoop } from './discovery/local-discovery'
import {
  connectServer as connectServerForDeps,
  disconnectServer as disconnectServerForDeps,
  forgetServer as forgetServerForDeps,
  hasConnectedLocalRuntime as hasConnectedLocalRuntimeForDeps,
  restartConnectedRuntimes as restartConnectedRuntimesForDeps,
  restartRuntime as restartRuntimeForDeps,
  stopExistingRuntime as stopExistingRuntimeForDeps,
  stopRuntime as stopRuntimeForDeps,
  stopRuntimeEntry as stopRuntimeEntryForDeps,
  type RuntimeLifecycleDeps,
} from './runtime/lifecycle'
import {
  authorizeMcpServer,
  broadcastMcpSnapshot as broadcastMcpSnapshotForDeps,
  disableMcpServer,
  enableMcpServer,
  getMcpSnapshot,
  handleAuthorizeUrl as handleAuthorizeMcpUrl,
  reconnectMcpServer,
} from './runtime/mcp'
import {
  createDesktopTray,
  createTrayIcon,
  updateTray as updateTrayForDeps,
} from './ui/tray'
import { showAboutDialog as showAboutDialogForDeps } from './ui/about-dialog'
import {
  buildApplicationMenu as buildApplicationMenuForDeps,
  popupAppIconMenu as popupAppIconMenuForDeps,
  popupApplicationMenuSection as popupApplicationMenuSectionForDeps,
  type ApplicationMenuDeps,
} from './ui/application-menu'
import {
  desktopStateForWindow as desktopStateForDeps,
  refreshDesktopState as refreshDesktopStateForDeps,
  setState as setStateForDeps,
  type DesktopStateDeps,
} from './state/desktop-state'
import {
  getNavigationState,
  installNavigationStateBridge,
  navigateHistory,
  sendFullscreenState,
} from './windows/navigation'
import {
  createWindow as createWindowForDeps,
  showOrCreateWindow as showOrCreateWindowForDeps,
  type WindowManagerDeps,
} from './windows/manager'
import {
  installEditableContextMenu,
  installExternalLinkHandler,
  showSelectionContextMenu,
} from './windows/context-menu'
import {
  registerIpcHandlers as registerIpcHandlersForDeps,
  type RegisterDesktopIpcDeps,
} from './ipc/register'
import { normalizeServer, serverInList } from './settings/servers'
import {
  loadDesktopSettings,
  saveDesktopSettings,
  settingsPath,
} from './settings/store'
import { injectDevPrincipalHeaders as injectDevPrincipalHeadersForServer } from './shared/headers'
import {
  APP_DISPLAY_NAME,
  DEFAULT_LOCAL_DEV_PRINCIPAL,
  DESKTOP_USER_DATA_DIR,
  EXTERNAL_LINK_PROTOCOLS,
  explicitDevPrincipalFromEnv,
  IGNORE_CONNECTION_LIMIT_DOMAINS,
  INITIAL_SERVER_URL,
  MCP_OAUTH_REDIRECT_BASE,
  PULL_WAKE_RUNNER_ID,
} from './shared/constants'
import {
  APP_ICON_PATH,
  secretsPath,
  TRAY_ICON_2X_PATH,
  TRAY_ICON_PATH,
} from './shared/paths'
import type {
  ApiKeys,
  ApiKeysStatus,
  CodexAuthSource,
  CodexStatus,
  ConnectServerOptions,
  DesktopAppearance,
  DesktopCommand,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopState,
  OnboardingState,
  RegistrySnapshot,
  RuntimeEntry,
  ServerConfig,
} from './shared/types'
import type { CloudAuthState } from './cloud-auth'
import type { CloudAgentServersState } from './cloud-agent-servers'
import {
  BrowserWindow,
  app,
  dialog,
  nativeImage,
  nativeTheme,
  session,
} from 'electron'
import fixPath from 'fix-path'
import { rm } from 'node:fs/promises'
import path from 'node:path'

// GUI-launched desktop apps don't inherit the user's shell PATH — restore it
// so child processes can find CLI tools like `gh`.
fixPath()

if (DESKTOP_USER_DATA_DIR) {
  app.setPath(`userData`, path.resolve(DESKTOP_USER_DATA_DIR))
}

// Electric streams can hold many long-polling HTTP requests open to the same
// local agents server. Electron supports bypassing Chromium's connection cap
// for a domain list; this must run before Electron creates its network context.
app.commandLine.appendSwitch(
  `ignore-connections-limit`,
  IGNORE_CONNECTION_LIMIT_DOMAINS
)
console.info(
  `[agents-desktop] ignore-connections-limit=${app.commandLine.getSwitchValue(
    `ignore-connections-limit`
  )}`
)

const EXPLICIT_DEV_PRINCIPAL = explicitDevPrincipalFromEnv()

const desktopContext = createDesktopAppContext({
  secretsPath,
  onCloudAuthState: broadcastCloudAuthState,
  onCloudAgentServersState: broadcastCloudAgentServersState,
})
const settings = desktopContext.settings
const apiKeys = desktopContext.apiKeys
const state = desktopContext.state
const windows = desktopContext.windows
const windowSelections = desktopContext.windowSelections
const runtimeEntries = desktopContext.runtimeEntries
const lastMcpSnapshots = desktopContext.lastMcpSnapshots

function configureRuntimeEnvironment(): void {
  // Packaged macOS apps can launch with cwd `/`, which makes the agents
  // logger's default `./logs` path resolve to unwritable `/logs`.
  process.env.ELECTRIC_AGENTS_LOG_DIR ??= path.join(
    app.getPath(`userData`),
    `logs`
  )
  // Desktop owns Codex consent. The runtime must not implicitly read
  // ~/.codex/auth.json just because it exists.
  process.env.ELECTRIC_CODEX_REQUIRE_OPT_IN = `1`
}
configureRuntimeEnvironment()

function broadcastCloudAuthState(next: CloudAuthState): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:cloud-auth-state-changed`, next)
    }
  }
}

function broadcastCloudAgentServersState(next: CloudAgentServersState): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:cloud-agent-servers-state-changed`, next)
    }
  }
}

const cloudAuthHeaderInjectionDeps: CloudAuthHeaderInjectionDeps = {
  getServers: () => settings.servers,
  getAgentsToken: (tenantId) =>
    desktopContext.services.cloudAgentServers?.getAgentsToken(tenantId),
  getCloudAuthState: () => desktopContext.services.cloudAuth?.getState(),
  injectDevPrincipalHeaders,
}

const desktopServerFetchDeps: DesktopServerFetchDeps = {
  getServers: () => settings.servers,
  buildSavedServerHeaders: (url) =>
    buildSavedServerHeaders(cloudAuthHeaderInjectionDeps, url),
}

function installCloudAuthHeaderInjection(): void {
  installCloudAuthHeaderInjectionForDeps(cloudAuthHeaderInjectionDeps)
}

async function desktopServerFetch(request: unknown) {
  return desktopServerFetchForDeps(desktopServerFetchDeps, request)
}

function findServer(serverId: string | null | undefined): ServerConfig | null {
  if (!serverId) return null
  return settings.servers.find((server) => server.id === serverId) ?? null
}

function defaultSelectedServerId(): string | null {
  if (serverInList(findServer(settings.defaultServerId), settings.servers)) {
    return settings.defaultServerId
  }
  return settings.servers[0]?.id ?? null
}

const codexAuthDeps: CodexAuthDeps = {
  settings,
  getSecretStore: desktopContext.getSecretStore,
  saveSettings,
  markCredentialsDirty,
}

function syncCodexEnvironment(): Promise<void> {
  return syncCodexEnvironmentForDeps(codexAuthDeps)
}

function getCodexStatus(): Promise<CodexStatus> {
  return getCodexStatusForDeps(codexAuthDeps)
}

async function restartConnectedRuntimes(): Promise<void> {
  await restartConnectedRuntimesForDeps(runtimeLifecycleDeps)
}

/**
 * `true` when at least one server is configured for a local runtime
 * and currently held in the `connected` desired state. Mirrors the
 * filter used by `restartConnectedRuntimes()` so the renderer's
 * "Restart local runtime to apply changes" banner is surfaced iff
 * clicking the restart button would actually do something. Includes
 * runtimes in `running`, `starting`, and `error` states — any active
 * connected runtime whose env-var snapshot could now be stale.
 */
function hasConnectedLocalRuntime(): boolean {
  return hasConnectedLocalRuntimeForDeps(runtimeLifecycleDeps)
}

/**
 * Called from every credential-mutation path (API keys, Codex
 * sign-in/out, source switch). Flags that the running local runtime
 * is now stale relative to the saved credentials, so the renderer
 * can surface the restart banner. No-op when nothing is connected
 * (the next start will pick up the new env automatically).
 */
function markCredentialsDirty(): void {
  if (!hasConnectedLocalRuntime()) return
  setCredentialsRestartPending(true)
}

function setCredentialsRestartPending(value: boolean): void {
  if (desktopContext.credentialsRestartPending === value) return
  desktopContext.credentialsRestartPending = value
  refreshDesktopState()
}

function enableCodexSource(source: CodexAuthSource): Promise<CodexStatus> {
  return enableCodexSourceForDeps(codexAuthDeps, source)
}

function disableCodex(): Promise<CodexStatus> {
  return disableCodexForDeps(codexAuthDeps)
}

function signInCodex(): Promise<CodexStatus | null> {
  return signInCodexForDeps(codexAuthDeps)
}

function applyApiKeys(): void {
  applyApiKeysToEnv(apiKeys, desktopContext.envApiKeysSnapshot, process.env)
}

function initialServerFromEnv(): ServerConfig | null {
  if (!INITIAL_SERVER_URL) return null
  try {
    const url = new URL(INITIAL_SERVER_URL)
    if (url.protocol !== `http:` && url.protocol !== `https:`) {
      console.warn(
        `[agents-desktop] Ignoring ELECTRIC_DESKTOP_SERVER_URL with unsupported protocol: ${INITIAL_SERVER_URL}`
      )
      return null
    }
    url.hash = ``
    url.search = ``
    return normalizeServer(
      {
        name: `Environment server`,
        url: url.toString().replace(/\/$/, ``),
        source: `manual`,
      },
      { defaultDesiredState: `connected` }
    )
  } catch {
    console.warn(
      `[agents-desktop] Ignoring invalid ELECTRIC_DESKTOP_SERVER_URL: ${INITIAL_SERVER_URL}`
    )
    return null
  }
}

async function applyInitialServerFromEnv(): Promise<void> {
  const server = initialServerFromEnv()
  if (!server) return

  const existing = settings.servers.find((entry) => entry.url === server.url)
  const next = existing ?? server
  if (!existing) {
    settings.servers = [...settings.servers, next]
    ensureRuntimeEntry(next)
  }
  if (!settings.defaultServerId) {
    settings.defaultServerId = next.id
  }
  Object.assign(state, desktopStateForWindow(null))
  await saveSettings()
}

async function loadSettings(): Promise<void> {
  const shouldSave = await loadDesktopSettings({
    settings,
    apiKeys,
    getSecretStore: desktopContext.getSecretStore,
    ensureRuntimeEntry,
    pullWakeRunnerId: PULL_WAKE_RUNNER_ID,
  })
  Object.assign(state, desktopStateForWindow(null))
  await applyInitialServerFromEnv()
  applyApiKeys()
  await syncCodexEnvironment()
  if (shouldSave) {
    await saveSettings()
  }
}

async function saveSettings(): Promise<void> {
  await saveDesktopSettings(settings)
}

function ensureRuntimeEntry(server: ServerConfig): RuntimeEntry {
  return ensureRuntimeEntryInStore(runtimeEntries, server)
}

function selectedServerIdForWindow(win: BrowserWindow | null): string | null {
  if (win && !win.isDestroyed()) {
    const existing = windowSelections.get(win.id)
    if (existing && findServer(existing)) return existing
  }
  return defaultSelectedServerId()
}

function injectDevPrincipalHeaders(server: ServerConfig): ServerConfig {
  return injectDevPrincipalHeadersForServer(server, {
    explicitDevPrincipal: EXPLICIT_DEV_PRINCIPAL,
    defaultLocalDevPrincipal: DEFAULT_LOCAL_DEV_PRINCIPAL,
  })
}

const desktopStateDeps: DesktopStateDeps = {
  windows,
  settings,
  state,
  credentialsRestartPending: () => desktopContext.credentialsRestartPending,
  pullWakeRunnerId: PULL_WAKE_RUNNER_ID,
  selectedServerIdForWindow,
  findServer,
  ensureRuntimeEntry,
  injectDevPrincipalHeaders,
  hasConnectedLocalRuntime,
  updateTray,
}

function desktopStateForWindow(win: BrowserWindow | null): DesktopState {
  return desktopStateForDeps(desktopStateDeps, win)
}

function sendCommand(command: DesktopCommand): void {
  const focused = BrowserWindow.getFocusedWindow()
  const target =
    focused ?? [...windows].find((win) => !win.isDestroyed()) ?? null
  target?.webContents.send(`desktop:command`, command)
}

function updateTray(): void {
  updateTrayForDeps({
    tray: desktopContext.shell.tray,
    servers: settings.servers,
    runtimeEntries,
    ensureRuntimeEntry,
    createWindow,
    sendCommand,
    connectServer,
    disconnectServer,
    saveSettings,
    stopRuntimeEntry,
    restartRuntime,
    refreshDesktopState,
    quitApp,
  })
}

function setState(patch: Partial<DesktopState>): void {
  setStateForDeps(desktopStateDeps, patch)
}

function refreshDesktopState(): void {
  refreshDesktopStateForDeps(desktopStateDeps)
}

const windowManagerDeps: WindowManagerDeps = {
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

function createWindow(): BrowserWindow {
  return createWindowForDeps(windowManagerDeps)
}

function showOrCreateWindow(): void {
  showOrCreateWindowForDeps(windows, createWindow)
}

async function stopExistingRuntime(): Promise<void> {
  await stopExistingRuntimeForDeps(runtimeLifecycleDeps)
}

function broadcastMcpSnapshot(
  serverId: string,
  snapshot: RegistrySnapshot
): void {
  broadcastMcpSnapshotForDeps(
    { snapshots: lastMcpSnapshots, windows },
    serverId,
    snapshot
  )
}

async function handleAuthorizeUrl(
  serverId: string,
  url: string,
  server: string
): Promise<void> {
  await handleAuthorizeMcpUrl({
    runtimeEntries,
    redirectBase: MCP_OAUTH_REDIRECT_BASE,
    serverId,
    url,
    server,
  })
}

const runtimeLifecycleDeps: RuntimeLifecycleDeps = {
  settings,
  runtimeEntries,
  windowSelections,
  findServer,
  ensureRuntimeEntry,
  saveSettings,
  refreshDesktopState,
  setState,
  setCredentialsRestartPending,
  injectDevPrincipalHeaders,
  configureRuntimeEnvironment,
  applyApiKeys,
  syncCodexEnvironment,
  broadcastMcpSnapshot,
  handleAuthorizeUrl,
  getCloudAgentServers: desktopContext.getCloudAgentServers,
  getCloudAuthState: () => desktopContext.services.cloudAuth?.getState(),
}

async function stopRuntimeEntry(entry: RuntimeEntry): Promise<void> {
  await stopRuntimeEntryForDeps(runtimeLifecycleDeps, entry)
}

async function connectServer(
  serverId: string,
  options: ConnectServerOptions = {}
): Promise<void> {
  await connectServerForDeps(runtimeLifecycleDeps, serverId, options)
}

async function disconnectServer(serverId: string): Promise<void> {
  await disconnectServerForDeps(runtimeLifecycleDeps, serverId)
}

async function forgetServer(serverId: string): Promise<void> {
  await forgetServerForDeps(runtimeLifecycleDeps, serverId)
}

async function restartRuntime(serverId?: string | null): Promise<void> {
  await restartRuntimeForDeps(
    runtimeLifecycleDeps,
    serverId ??
      selectedServerIdForWindow(BrowserWindow.getFocusedWindow()) ??
      settings.defaultServerId
  )
}

async function stopRuntime(serverId?: string | null): Promise<void> {
  await stopRuntimeForDeps(
    runtimeLifecycleDeps,
    serverId ??
      selectedServerIdForWindow(BrowserWindow.getFocusedWindow()) ??
      settings.defaultServerId
  )
}

async function getApiKeysStatus(): Promise<ApiKeysStatus> {
  return getApiKeysStatusForDeps({
    apiKeys,
    launchEnv: desktopContext.envApiKeysSnapshot,
    getCodexStatus,
  })
}

async function setApiKeys(next: ApiKeys): Promise<void> {
  await setApiKeysForDeps(
    {
      apiKeys,
      apiKeysRef: () => settings.apiKeysRef,
      secretStore: desktopContext.getSecretStore(),
      launchEnv: desktopContext.envApiKeysSnapshot,
      saveSettings,
      markCredentialsDirty,
      env: process.env,
    },
    next
  )
}

function getOnboardingState(): OnboardingState {
  const cloudStatus = desktopContext.services.cloudAuth?.getState().status
  return {
    dismissed: settings.onboardingDismissed === true,
    hasAnyKey: Boolean(
      apiKeys.anthropic ||
        apiKeys.openai ||
        apiKeys.deepseek ||
        settings.codex?.enabled
    ),
    signedIn: cloudStatus === `signed-in`,
  }
}

async function setOnboardingDismissed(dismissed: boolean): Promise<void> {
  settings.onboardingDismissed = dismissed
  await saveSettings()
}

async function chooseWorkingDirectory(): Promise<string | null | undefined> {
  const result = await dialog.showOpenDialog({
    properties: [`openDirectory`, `createDirectory`],
  })
  if (result.canceled) return settings.workingDirectory
  settings.workingDirectory = result.filePaths[0] ?? null
  setState({ workingDirectory: settings.workingDirectory })
  await saveSettings()
  await Promise.all(
    settings.servers
      .filter((server) => server.desiredState === `connected`)
      .map((server) => restartRuntime(server.id))
  )
  return settings.workingDirectory
}

async function pickDirectory(options?: {
  defaultPath?: string
}): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: [`openDirectory`, `createDirectory`],
    defaultPath: options?.defaultPath,
  })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
}

async function setSelectedServerForWindow(
  win: BrowserWindow | null,
  serverId: string | null
): Promise<void> {
  const next = findServer(serverId)?.id ?? null
  if (win && !win.isDestroyed()) {
    windowSelections.set(win.id, next)
  }
  settings.defaultServerId = next
  await saveSettings()
  refreshDesktopState()
}

async function setActiveServer(
  win: BrowserWindow | null,
  server: ServerConfig | null
): Promise<void> {
  const normalized = normalizeServer(server)
  const existing =
    normalized &&
    settings.servers.find(
      (candidate) =>
        candidate.id === normalized.id || candidate.url === normalized.url
    )
  await setSelectedServerForWindow(win, existing?.id ?? null)
}

async function quitApp(): Promise<void> {
  if (desktopContext.shell.isQuitting) return
  desktopContext.shell.isQuitting = true
  stopDiscoveryLoop()
  await stopExistingRuntime().catch(() => {})
  app.quit()
}

async function clearAllLocalDataAndRelaunch(): Promise<void> {
  await desktopContext.getCloudAuth().signOut()
  await desktopContext.getCloudAgentServers().stop()
  await Promise.all([
    session.defaultSession.clearStorageData(),
    session.defaultSession.clearCache(),
    rm(settingsPath(), { force: true }),
    rm(secretsPath(), { force: true }),
  ])
  desktopContext.services.secretStore = null
  app.relaunch()
  await quitApp()
}

const localDiscovery = createLocalDiscoveryLoop({
  runtimeEntries,
  state,
  setState,
})

async function runDiscovery(): Promise<void> {
  await localDiscovery.runDiscovery()
}

function startDiscoveryLoop(): void {
  localDiscovery.startDiscoveryLoop()
}

function stopDiscoveryLoop(): void {
  localDiscovery.stopDiscoveryLoop()
}

function refreshNativeTitleBars(): void {
  const symbolColor = nativeTheme.shouldUseDarkColors ? `#ededee` : `#1f2328`
  for (const win of windows) {
    win.setTitleBarOverlay?.({
      color: `#00000000`,
      symbolColor,
      height: 34,
    })
  }
}

function applyNativeAppearance(appearance: DesktopAppearance): void {
  nativeTheme.themeSource = appearance
  refreshNativeTitleBars()
}

const desktopIpcDeps: RegisterDesktopIpcDeps = {
  settings,
  state,
  runtimeEntries,
  findServer,
  ensureRuntimeEntry,
  saveSettings,
  refreshDesktopState,
  setState,
  desktopStateForWindow,
  desktopServerFetch,
  setActiveServer,
  setSelectedServerForWindow,
  selectedServerIdForWindow,
  stopRuntimeEntry,
  restartRuntime,
  connectServer,
  disconnectServer,
  forgetServer,
  stopRuntime,
  runDiscovery,
  getApiKeysStatus,
  setApiKeys,
  signInCodex,
  enableCodexSource,
  disableCodex,
  restartConnectedRuntimes,
  clearAllLocalDataAndRelaunch,
  getOnboardingState,
  setOnboardingDismissed,
  chooseWorkingDirectory,
  pickDirectory,
  applyNativeAppearance,
  showSelectionContextMenu,
  popupApplicationMenuSection,
  popupAppIconMenu,
  getNavigationState,
  navigateHistory,
  getMcpSnapshot: (serverId) => getMcpSnapshot(lastMcpSnapshots, serverId),
  authorizeMcpServer: (serverId, name) =>
    authorizeMcpServer(runtimeEntries, serverId, name),
  reconnectMcpServer: (serverId, name) =>
    reconnectMcpServer(runtimeEntries, serverId, name),
  disableMcpServer: (serverId, name) =>
    disableMcpServer(runtimeEntries, serverId, name),
  enableMcpServer: (serverId, name) =>
    enableMcpServer(runtimeEntries, serverId, name),
  getCloudAuth: desktopContext.getCloudAuth,
  getCloudAgentServers: desktopContext.getCloudAgentServers,
}

function registerIpcHandlers(): void {
  registerIpcHandlersForDeps(desktopIpcDeps)
}

const applicationMenuDeps: ApplicationMenuDeps = {
  windows,
  createWindow,
  sendCommand,
  quitApp,
  showAboutDialog,
}

function showAboutDialog(): void {
  showAboutDialogForDeps({
    getAboutWindow: () => desktopContext.shell.aboutWindow,
    setAboutWindow: (win) => {
      desktopContext.shell.aboutWindow = win
    },
  })
}

function buildApplicationMenu(): void {
  buildApplicationMenuForDeps(applicationMenuDeps)
}

function popupApplicationMenuSection(
  win: BrowserWindow,
  section: DesktopMenuSection,
  bounds: DesktopMenuPopupBounds,
  state: DesktopMenuState
): void {
  popupApplicationMenuSectionForDeps(
    applicationMenuDeps,
    win,
    section,
    bounds,
    state
  )
}

function popupAppIconMenu(
  win: BrowserWindow,
  bounds: DesktopMenuPopupBounds
): void {
  popupAppIconMenuForDeps({ showAboutDialog }, win, bounds)
}

async function main(): Promise<void> {
  // Make sure macOS shows the product name everywhere (about menu,
  // dock tooltip, default window title) instead of the npm package id.
  app.setName(APP_DISPLAY_NAME)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on(`second-instance`, () => {
    showOrCreateWindow()
  })

  app.on(`window-all-closed`, () => {
    // Keep the tray/menu bar runtime alive until the user explicitly quits.
  })

  app.on(`activate`, () => {
    showOrCreateWindow()
  })

  // Re-render the menu when focus changes so the Window submenu's
  // checkmark moves to the now-focused window.
  app.on(`browser-window-focus`, () => buildApplicationMenu())
  app.on(`browser-window-blur`, () => buildApplicationMenu())

  app.on(`before-quit`, (event) => {
    if (desktopContext.shell.isQuitting) return
    event.preventDefault()
    void quitApp()
  })

  await app.whenReady()
  configureRuntimeEnvironment()
  await loadSettings()
  registerIpcHandlers()
  await desktopContext.getCloudAuth().initialize()
  // Hydrate the per-tenant agents-token cache from `SecretStore`
  // BEFORE we install the webRequest hook so a window opening
  // straight onto a saved cloud server gets the auth headers added.
  const cloudTenantIds = settings.servers
    .filter((s) => s.source === `electric-cloud` && s.tenantId)
    .map((s) => s.tenantId as string)
  await desktopContext.getCloudAgentServers().hydrateTokens(cloudTenantIds)
  installCloudAuthHeaderInjection()
  // Eagerly kick the cloud-agent-servers streams once on boot — the
  // CloudAuth subscriber handles subsequent sign-in/sign-out edges.
  // Safe to call when signed-out: `start()` no-ops without a token.
  void desktopContext.getCloudAgentServers().start()
  nativeTheme.on(`updated`, refreshNativeTitleBars)

  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion() || `dev`,
    version: app.getVersion() || `dev`,
    copyright: `© ${new Date().getFullYear()} Electric DB Limited`,
    website: `https://electric.ax/agents`,
    // `iconPath` only affects Linux/Windows. macOS shows the app
    // bundle icon, which during dev is the Electron atom — we surface
    // the proper Electric mark via the custom About window instead.
    iconPath: APP_ICON_PATH,
    credits: `The durable runtime for long-lived agents.`,
  })

  // Dock icon on macOS — replaces the default Electron icon during
  // `electron .` dev. (Linux/Windows package icons are wired via the
  // builder config when we add packaging.)
  if (process.platform === `darwin` && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(APP_ICON_PATH)
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon)
      }
    } catch {
      // Non-fatal — dev still works with the default Electron icon.
    }
  }

  const trayIcon = createTrayIcon({
    iconPath: TRAY_ICON_PATH,
    icon2xPath: TRAY_ICON_2X_PATH,
  })
  if (trayIcon.isEmpty()) {
    console.error(
      `[agents-desktop] Tray icon failed to load from ${TRAY_ICON_PATH}; ` +
        `the menu bar item may be invisible.`
    )
  }
  desktopContext.shell.tray = createDesktopTray(trayIcon, () =>
    showOrCreateWindow()
  )
  updateTray()

  buildApplicationMenu()

  createWindow()
  for (const server of settings.servers) {
    if (server.desiredState === `connected`) {
      void connectServer(server.id)
    }
  }
  startDiscoveryLoop()
}

void main()
