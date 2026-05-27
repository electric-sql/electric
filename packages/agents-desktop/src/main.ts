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
import { checkAgentsServerHealth } from './runtime/health'
import {
  createConnectionState,
  ensureRuntimeEntry as ensureRuntimeEntryInStore,
  runtimeStatusForConnection,
} from './runtime/entries'
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
import { registerCloudIpcHandlers } from './ipc/cloud'
import {
  normalizeServer,
  normalizeServers,
  serverInList,
} from './settings/servers'
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
  DEV_SERVER_URL,
  DISCOVERY_INTERVAL_MS,
  DISCOVERY_PORTS,
  DISCOVERY_TIMEOUT_MS,
  EXTERNAL_LINK_PROTOCOLS,
  explicitDevPrincipalFromEnv,
  IGNORE_CONNECTION_LIMIT_DOMAINS,
  INITIAL_SERVER_URL,
  MCP_OAUTH_REDIRECT_BASE,
  PULL_WAKE_RUNNER_ID,
} from './shared/constants'
import {
  APP_ICON_PATH,
  PRELOAD_PATH,
  RENDERER_INDEX,
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
  DesktopContextMenuRequest,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopNavigationState,
  DesktopState,
  DiscoveredServer,
  OnboardingState,
  RegistrySnapshot,
  RuntimeEntry,
  ServerConfig,
} from './shared/types'
import type { CloudAuthState } from './cloud-auth'
import type { CloudAgentServersState } from './cloud-agent-servers'
import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from 'electron'
import fixPath from 'fix-path'
import { rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
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

function desktopStateForWindow(win: BrowserWindow | null): DesktopState {
  const selectedServerId = selectedServerIdForWindow(win)
  const activeServer = findServer(selectedServerId)
  const entry = activeServer ? ensureRuntimeEntry(activeServer) : null
  return {
    servers: settings.servers,
    selectedServerId,
    connections: settings.servers.map((server) =>
      createConnectionState(ensureRuntimeEntry(server))
    ),
    runtimeStatus: runtimeStatusForConnection(entry),
    runtimeUrl: entry?.runtimeUrl ?? null,
    activeServer: activeServer ? injectDevPrincipalHeaders(activeServer) : null,
    workingDirectory: settings.workingDirectory,
    error: entry?.lastError ?? null,
    discoveredServers: state.discoveredServers,
    pullWakeRunnerId: PULL_WAKE_RUNNER_ID ?? settings.pullWakeRunnerId ?? null,
    // Only expose the pending state when there's actually a connected
    // local runtime to restart; otherwise the banner would prompt for
    // an action that wouldn't do anything.
    credentialsRestartPending:
      desktopContext.credentialsRestartPending && hasConnectedLocalRuntime(),
  }
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

function broadcastState(): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:state-changed`, desktopStateForWindow(win))
    }
  }
}

function getNavigationState(win: BrowserWindow): DesktopNavigationState {
  return {
    canGoBack: win.webContents.canGoBack(),
    canGoForward: win.webContents.canGoForward(),
  }
}

function sendNavigationState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(
    `desktop:navigation-state-changed`,
    getNavigationState(win)
  )
}

function sendFullscreenState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(`desktop:fullscreen-state-changed`, win.isFullScreen())
}

function setState(patch: Partial<DesktopState>): void {
  Object.assign(state, patch)
  updateTray()
  broadcastState()
}

function refreshDesktopState(): void {
  Object.assign(state, desktopStateForWindow(null))
  updateTray()
  broadcastState()
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === `darwin`
  const isWindows = process.platform === `win32`
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: `Electric Agents`,
    // macOS: hide the native titlebar but keep the traffic-light buttons
    // overlaid on the window content. The renderer paints the toolbar
    // with extra left-padding so its icons sit to the right of the
    // traffic lights and the row reads as a single chrome strip.
    // macOS keeps the native traffic lights in a hiddenInset titlebar.
    // Windows/Linux use a hidden titlebar plus Electron's native
    // window-controls overlay so the renderer can paint a Cursor-style
    // icon/menu strip on the same row as the minimize/maximize/close
    // controls.
    titleBarStyle: isMac ? `hiddenInset` : `hidden`,
    frame: true,
    autoHideMenuBar: !isMac,
    // Keep true transparent windows macOS-only. On Windows, `transparent: true`
    // creates a layered window, which drops the native DWM border, rounded
    // corners, and shadow. Mica is applied via `backgroundMaterial` instead.
    transparent: isMac,
    backgroundColor: isMac ? `#00000000` : undefined,
    vibrancy: isMac ? `sidebar` : undefined,
    visualEffectState: isMac ? `active` : undefined,
    backgroundMaterial: isWindows ? `mica` : undefined,
    titleBarOverlay: isMac
      ? undefined
      : {
          color: isWindows ? `#00000000` : `#f7f7f7`,
          symbolColor: `#1f2328`,
          height: 34,
        },
    // Standard macOS hiddenInset traffic-light origin (top-left of the
    // leftmost light). The renderer matches the 44px desktop header
    // height so the 24px IconButton glyphs flex-center to the same y as
    // the light centers — the row reads as a single chrome strip.
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isMac) {
    win.setVibrancy(`sidebar`)
  } else if (isWindows) {
    win.setBackgroundMaterial(`mica`)
  }

  windows.add(win)
  windowSelections.set(win.id, defaultSelectedServerId())
  if (!isMac) {
    win.setMenuBarVisibility(false)
  }
  installEditableContextMenu(win)
  installExternalLinkHandler(win)
  installNavigationStateBridge(win)
  win.on(`enter-full-screen`, () => sendFullscreenState(win))
  win.on(`leave-full-screen`, () => sendFullscreenState(win))
  win.webContents.on(`did-finish-load`, () => sendFullscreenState(win))
  win.on(`closed`, () => {
    windows.delete(win)
    windowSelections.delete(win.id)
    buildApplicationMenu()
  })
  // The renderer keeps `document.title` in sync with the active tile's
  // entity (see `useDocumentTitle.ts`). Forwarding `page-title-updated`
  // into a menu rebuild lets the Window submenu show one entry per
  // open window labelled with that window's active session.
  win.webContents.on(`page-title-updated`, () => {
    buildApplicationMenu()
  })
  win.on(`focus`, () => {
    buildApplicationMenu()
  })
  // Dev: load from the running Vite dev server so the renderer gets
  // HMR (CSS / React Refresh / module replacement). Production: load
  // the prebuilt `dist-desktop/index.html` from disk via file://.
  // DevTools are not auto-opened — multi-window setups would spawn
  // a detached DevTools per window, which gets noisy fast. The
  // standard `View → Toggle Developer Tools` menu item (Cmd+Opt+I /
  // Ctrl+Shift+I) works in every window when you actually need it.
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(RENDERER_INDEX)
  }
  buildApplicationMenu()

  return win
}

function installNavigationStateBridge(win: BrowserWindow): void {
  const notify = () => sendNavigationState(win)
  win.webContents.on(`did-finish-load`, notify)
  win.webContents.on(`did-navigate`, notify)
  win.webContents.on(`did-navigate-in-page`, notify)
}

function isExternalLink(url: string): boolean {
  try {
    return EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

function installExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) {
      void shell.openExternal(url)
    }
    return { action: `deny` }
  })

  win.webContents.on(`will-navigate`, (event, url) => {
    if (!isExternalLink(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

function installEditableContextMenu(win: BrowserWindow): void {
  win.webContents.on(`context-menu`, (_event, params) => {
    if (params.linkURL && isExternalLink(params.linkURL)) {
      showLinkContextMenu(win, params.linkURL)
      return
    }

    if (!params.isEditable) return

    const template: Array<Electron.MenuItemConstructorOptions> = []
    const suggestions = params.dictionarySuggestions.slice(0, 5)

    if (params.misspelledWord) {
      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          template.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          })
        }
      } else {
        template.push({ label: `No Guesses Found`, enabled: false })
      }

      template.push({
        label: `Learn Spelling`,
        click: () => {
          win.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord
          )
        },
      })
      template.push({ type: `separator` })
    }

    template.push(
      { role: `undo`, enabled: params.editFlags.canUndo },
      { role: `redo`, enabled: params.editFlags.canRedo },
      { type: `separator` },
      { role: `cut`, enabled: params.editFlags.canCut },
      { role: `copy`, enabled: params.editFlags.canCopy },
      { role: `paste`, enabled: params.editFlags.canPaste },
      {
        role: `pasteAndMatchStyle`,
        enabled: params.editFlags.canPaste,
      },
      { role: `delete`, enabled: params.editFlags.canDelete },
      { type: `separator` },
      { role: `selectAll`, enabled: params.editFlags.canSelectAll }
    )

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function showLinkContextMenu(win: BrowserWindow, url: string): void {
  Menu.buildFromTemplate([
    {
      label: `Open Link in Browser`,
      click: () => {
        void shell.openExternal(url)
      },
    },
    {
      label: `Copy Link`,
      click: () => clipboard.writeText(url),
    },
  ]).popup({ window: win })
}

function showSelectionContextMenu(
  win: BrowserWindow,
  request: DesktopContextMenuRequest
): void {
  const selectionText = request.selectionText.trim()
  if (selectionText.length === 0) return

  Menu.buildFromTemplate([
    {
      label: `Copy`,
      accelerator: `CmdOrCtrl+C`,
      click: () => clipboard.writeText(selectionText),
    },
  ]).popup({ window: win })
}

function showOrCreateWindow(): void {
  const existing = [...windows].find((win) => !win.isDestroyed())
  if (existing) {
    existing.show()
    existing.focus()
    return
  }
  createWindow()
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

/**
 * Localhost ports we probe for running `agents-server` instances.
 *
 * - 4437: `packages/agents-server` `DEFAULT_PORT`.
 * - 4438/4439: common offsets when running multiple servers side-by-side.
 * - 3000/4000/8080: common Node/dev defaults users sometimes pick.
 *
 * Identification is via `GET /_electric/health` returning
 * `{ status: "ok" }` (see `ElectricAgentsServer.handleRequestInner`),
 * so collisions with unrelated services on these ports are filtered out.
 */
let discoveryTimer: NodeJS.Timeout | null = null
let discoveryInFlight: Promise<void> | null = null

async function probeAgentsServer(url: string): Promise<boolean> {
  const result = await checkAgentsServerHealth(url, DISCOVERY_TIMEOUT_MS)
  return result.ok
}

async function runDiscovery(): Promise<void> {
  if (discoveryInFlight) {
    await discoveryInFlight
    return
  }
  discoveryInFlight = (async () => {
    // Don't probe the bundled runtime URL — that's our own Horton
    // process and isn't a separate agents-server.
    const skipPorts = new Set(
      [...runtimeEntries.values()]
        .map((entry) => {
          try {
            return entry.runtimeUrl ? new URL(entry.runtimeUrl).port : null
          } catch {
            return null
          }
        })
        .filter((port): port is string => Boolean(port))
    )
    const results = await Promise.all(
      DISCOVERY_PORTS.map(async (port) => {
        if (skipPorts.has(String(port))) return null
        const url = `http://127.0.0.1:${port}`
        const ok = await probeAgentsServer(url)
        return ok ? { url, port, lastSeen: Date.now() } : null
      })
    )
    const found = results.filter(
      (entry): entry is DiscoveredServer => entry !== null
    )
    found.sort((a, b) => a.port - b.port)

    const prev = state.discoveredServers
    const same =
      prev.length === found.length &&
      prev.every((entry, i) => entry.url === found[i]?.url)
    if (same) {
      // Same set of URLs — keep prior `lastSeen` to avoid noisy
      // broadcasts to renderers every tick.
      return
    }
    setState({ discoveredServers: found })
  })()
  try {
    await discoveryInFlight
  } finally {
    discoveryInFlight = null
  }
}

function startDiscoveryLoop(): void {
  if (discoveryTimer) return
  void runDiscovery()
  discoveryTimer = setInterval(() => {
    void runDiscovery()
  }, DISCOVERY_INTERVAL_MS)
}

function stopDiscoveryLoop(): void {
  if (discoveryTimer) {
    clearInterval(discoveryTimer)
    discoveryTimer = null
  }
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

function registerIpcHandlers(): void {
  ipcMain.handle(`desktop:get-servers`, () => settings.servers)
  ipcMain.handle(
    `desktop:set-native-appearance`,
    (_event, appearance: DesktopAppearance) => {
      applyNativeAppearance(appearance)
    }
  )
  ipcMain.handle(
    `desktop:save-servers`,
    async (_event, servers: Array<ServerConfig>) => {
      const previous = new Map(settings.servers.map((s) => [s.url, s]))
      settings.servers = normalizeServers(servers).map((server) => ({
        ...server,
        desiredState:
          previous.get(server.url)?.desiredState ?? server.desiredState,
      }))
      for (const server of settings.servers) {
        const entry = ensureRuntimeEntry(server)
        if (!server.localRuntimeEnabled && entry.runtime) {
          await stopRuntimeEntry(entry)
          entry.localRuntimeStatus = `disabled`
          if (server.desiredState === `connected`) {
            entry.status = `connected`
            entry.lastError = null
            entry.lastConnectedAt = Date.now()
          }
        } else if (server.localRuntimeEnabled && entry.status === `connected`) {
          void restartRuntime(server.id)
        }
      }
      const liveIds = new Set(settings.servers.map((server) => server.id))
      for (const [id, entry] of runtimeEntries) {
        if (!liveIds.has(id)) {
          await stopRuntimeEntry(entry)
          runtimeEntries.delete(id)
        }
      }
      if (!findServer(settings.defaultServerId)) {
        settings.defaultServerId = settings.servers[0]?.id ?? null
      }
      await saveSettings()
      refreshDesktopState()
    }
  )
  ipcMain.handle(`desktop:get-state`, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return desktopStateForWindow(win)
  })
  ipcMain.handle(`desktop:server-fetch`, (_event, request: unknown) =>
    desktopServerFetch(request)
  )
  ipcMain.handle(
    `desktop:set-active-server`,
    async (_event, server: ServerConfig | null) => {
      const win = BrowserWindow.fromWebContents(_event.sender)
      await setActiveServer(win, server)
    }
  )
  ipcMain.handle(`desktop:set-selected-server`, async (event, serverId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await setSelectedServerForWindow(
      win,
      typeof serverId === `string` ? serverId : null
    )
  })
  ipcMain.handle(
    `desktop:connect-server`,
    async (_event, serverId, options?: ConnectServerOptions) => {
      if (typeof serverId === `string`) await connectServer(serverId, options)
    }
  )
  ipcMain.handle(`desktop:disconnect-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await disconnectServer(serverId)
  })
  ipcMain.handle(`desktop:forget-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await forgetServer(serverId)
  })
  ipcMain.handle(
    `desktop:restart-runtime`,
    async (event, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      await restartRuntime(
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      )
    }
  )
  ipcMain.handle(`desktop:stop-runtime`, async (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await stopRuntime(
      typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
    )
  })
  ipcMain.handle(`desktop:rescan-servers`, async () => {
    await runDiscovery()
    return state.discoveredServers
  })
  ipcMain.handle(`desktop:get-api-keys-status`, () => getApiKeysStatus())
  ipcMain.handle(`desktop:save-api-keys`, async (_event, keys: ApiKeys) => {
    await setApiKeys(keys)
  })
  ipcMain.handle(`desktop:codex-sign-in`, () => signInCodex())
  ipcMain.handle(
    `desktop:codex-enable-source`,
    (_event, source: CodexAuthSource) => enableCodexSource(source)
  )
  ipcMain.handle(`desktop:codex-disable`, () => disableCodex())
  ipcMain.handle(`desktop:restart-local-runtimes`, async () => {
    await restartConnectedRuntimes()
  })
  ipcMain.handle(`desktop:clear-all-local-data`, async () => {
    await clearAllLocalDataAndRelaunch()
  })
  ipcMain.handle(`desktop:get-onboarding-state`, () => getOnboardingState())
  ipcMain.handle(
    `desktop:set-onboarding-dismissed`,
    async (_event, dismissed: boolean) => {
      await setOnboardingDismissed(Boolean(dismissed))
    }
  )
  ipcMain.handle(
    `desktop:get-working-directory`,
    () => settings.workingDirectory
  )
  ipcMain.handle(`desktop:choose-working-directory`, async () => {
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
  })
  // One-shot directory picker — does NOT mutate the runtime cwd or
  // restart anything. Used by the new-session screen so each spawned
  // session can carry its own `workingDirectory` spawn arg without
  // disturbing the global default. Returns `null` on cancel; caller
  // is responsible for treating the result as ephemeral and (if it
  // wants to remember it) plumbing it into recent-dirs storage.
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
  ipcMain.on(
    `desktop:show-context-menu`,
    (event, request: DesktopContextMenuRequest) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      if (request.kind === `selection`) {
        showSelectionContextMenu(win, request)
      }
    }
  )
  ipcMain.handle(
    `desktop:show-menu-section`,
    (
      event,
      section: DesktopMenuSection,
      bounds: DesktopMenuPopupBounds,
      menuState: DesktopMenuState
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      popupApplicationMenuSection(win, section, bounds, menuState)
    }
  )
  ipcMain.handle(
    `desktop:show-app-menu`,
    (event, bounds: DesktopMenuPopupBounds) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      popupAppIconMenu(win, bounds)
    }
  )
  ipcMain.handle(`desktop:get-navigation-state`, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return {
        canGoBack: false,
        canGoForward: false,
      } satisfies DesktopNavigationState
    }
    return getNavigationState(win)
  })
  ipcMain.handle(
    `desktop:navigate-history`,
    (event, direction: `back` | `forward`) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      if (direction === `back` && win.webContents.canGoBack()) {
        win.webContents.goBack()
      } else if (direction === `forward` && win.webContents.canGoForward()) {
        win.webContents.goForward()
      }
      sendNavigationState(win)
    }
  )

  registerCloudIpcHandlers({
    getCloudAuth: desktopContext.getCloudAuth,
    getCloudAgentServers: desktopContext.getCloudAgentServers,
  })

  // ── MCP registry IPC ─────────────────────────────────────────────
  // Renderers subscribe to `desktop:mcp-state` push events; this handler
  // returns the most recent snapshot so the renderer can render before
  // the next push lands. Empty list when no runtime is running.
  ipcMain.handle(`desktop:mcp-snapshot`, (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const id =
      typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
    return getMcpSnapshot(lastMcpSnapshots, id)
  })
  // Mutation handlers — translate IPC calls into registry methods.
  // No-op gracefully when no runtime is running; renderer should not
  // depend on these throwing.
  ipcMain.handle(
    `desktop:mcp-authorize`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      await authorizeMcpServer(runtimeEntries, id, name)
    }
  )
  ipcMain.handle(
    `desktop:mcp-reconnect`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      await reconnectMcpServer(runtimeEntries, id, name)
    }
  )
  ipcMain.handle(
    `desktop:mcp-disable`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      await disableMcpServer(runtimeEntries, id, name)
    }
  )
  ipcMain.handle(
    `desktop:mcp-enable`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      await enableMcpServer(runtimeEntries, id, name)
    }
  )
}

function windowDisplayLabel(win: BrowserWindow): string {
  const raw = win.getTitle()
  if (!raw) return APP_DISPLAY_NAME
  // The renderer formats titles as `${session} — Electric Agents`.
  // Strip the suffix so the Window submenu reads cleanly as just the
  // session name (the menu already lives under "Electric Agents").
  const suffix = ` — ${APP_DISPLAY_NAME}`
  if (raw.endsWith(suffix)) {
    return raw.slice(0, -suffix.length) || APP_DISPLAY_NAME
  }
  return raw
}

/**
 * Custom About panel rendered as a small frameless `BrowserWindow`.
 *
 * The macOS native About panel only honours `iconPath` on Linux /
 * Windows — on darwin it always shows the bundle icon, which during
 * `electron .` dev mode is Electron's default atom. A standalone
 * window lets us show the real Electric mark and consistent
 * brand copy on every platform.
 */
function showAboutDialog(): void {
  if (
    desktopContext.shell.aboutWindow &&
    !desktopContext.shell.aboutWindow.isDestroyed()
  ) {
    desktopContext.shell.aboutWindow.focus()
    return
  }

  const iconBase64 = (() => {
    try {
      return readFileSync(APP_ICON_PATH).toString(`base64`)
    } catch {
      return ``
    }
  })()
  const iconSrc = iconBase64 ? `data:image/png;base64,${iconBase64}` : ``

  const html = `<!doctype html>
<html lang="en" data-electric-desktop="true">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<title>About ${APP_DISPLAY_NAME}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f8fa;
    --fg: #15161a;
    --fg-muted: #6b6f78;
    --link: #1d6cff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1c1e22; --fg: #f1f2f4; --fg-muted: #a3a8b2; --link: #6aa3ff; }
  }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    -webkit-app-region: drag;
  }
  main {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 36px 28px 22px;
    gap: 10px;
  }
  .icon { width: 96px; height: 96px; image-rendering: -webkit-optimize-contrast; }
  .name { font-size: 19px; font-weight: 600; margin: 6px 0 0; letter-spacing: -0.01em; }
  .version { font-size: 12px; color: var(--fg-muted); margin: 0; }
  .tagline {
    font-size: 13px; font-weight: 500; margin: 14px 0 0;
    line-height: 1.45; max-width: 300px;
  }
  .body {
    font-size: 12px; color: var(--fg-muted); margin: 8px 0 0;
    line-height: 1.55; max-width: 300px;
  }
  .meta {
    font-size: 11px; color: var(--fg-muted);
    margin: 18px 0 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  a {
    color: var(--link); text-decoration: none;
    -webkit-app-region: no-drag;
  }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main>
    ${iconSrc ? `<img class="icon" src="${iconSrc}" alt="${APP_DISPLAY_NAME}" />` : ``}
    <h1 class="name">${APP_DISPLAY_NAME}</h1>
    <p class="version">Version ${app.getVersion() || `dev`}</p>
    <p class="tagline">The durable runtime for long-lived agents.</p>
    <p class="body">
      Built on Electric Streams, every agent sleeps when idle, wakes on
      demand and survives restarts — bringing durable, composable,
      serverless agents to the infrastructure you already run.
    </p>
    <div class="meta">
      <a href="https://electric.ax/agents/" target="_blank" rel="noreferrer">electric.ax/agents</a>
      <span>© ${new Date().getFullYear()} Electric DB Limited</span>
    </div>
  </main>
</body>
</html>`

  const win = new BrowserWindow({
    width: 380,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${APP_DISPLAY_NAME}`,
    titleBarStyle: process.platform === `darwin` ? `hiddenInset` : `default`,
    trafficLightPosition:
      process.platform === `darwin` ? { x: 12, y: 12 } : undefined,
    backgroundColor: `#f7f8fa`,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  desktopContext.shell.aboutWindow = win
  win.setMenuBarVisibility(false)
  win.on(`closed`, () => {
    if (desktopContext.shell.aboutWindow === win) {
      desktopContext.shell.aboutWindow = null
    }
  })
  win.once(`ready-to-show`, () => win.show())
  // Open external links (electric.ax/agents) in the user's browser
  // instead of inside this little About window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: `deny` }
  })
  win.webContents.on(`will-navigate`, (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function buildApplicationMenuTemplate(): Array<Electron.MenuItemConstructorOptions> {
  const isMac = process.platform === `darwin`
  const focused = BrowserWindow.getFocusedWindow()
  const liveWindows = [...windows].filter((win) => !win.isDestroyed())

  // Sub-menu shared between File on Win/Linux and the application menu
  // on macOS. Each item maps to a renderer command implemented in the
  // shared `agents-server-ui` (see hooks under `src/hooks/`) so the
  // behaviour stays identical to the in-app buttons / hotkeys.
  const fileSubmenu: Array<Electron.MenuItemConstructorOptions> = [
    {
      label: `New Chat`,
      accelerator: `CommandOrControl+N`,
      click: () => sendCommand(`new-chat`),
    },
    {
      label: `New Window`,
      accelerator: `Shift+CommandOrControl+N`,
      click: () => createWindow(),
    },
    ...(!isMac
      ? ([
          { type: `separator` },
          {
            label: `Settings…`,
            accelerator: `CommandOrControl+,`,
            click: () => sendCommand(`open-settings`),
          },
        ] as Array<Electron.MenuItemConstructorOptions>)
      : []),
    { type: `separator` },
    {
      label: `Close Tile`,
      accelerator: `CommandOrControl+W`,
      click: () => sendCommand(`close-tile`),
    },
    {
      label: `Close Window`,
      accelerator: `Shift+CommandOrControl+W`,
      role: `close`,
    },
  ]

  return [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { role: `about` as const },
              { type: `separator` as const },
              {
                label: `Settings…`,
                accelerator: `CommandOrControl+,`,
                click: () => sendCommand(`open-settings`),
              },
              { type: `separator` as const },
              { role: `services` as const },
              { type: `separator` as const },
              { role: `hide` as const },
              { role: `hideOthers` as const },
              { role: `unhide` as const },
              { type: `separator` as const },
              {
                label: `Quit ${APP_DISPLAY_NAME}`,
                accelerator: `CommandOrControl+Q`,
                click: () => void quitApp(),
              },
            ],
          },
        ]
      : []),
    {
      label: `File`,
      submenu: fileSubmenu,
    },
    {
      label: `Edit`,
      submenu: [
        { role: `undo` },
        { role: `redo` },
        { type: `separator` },
        { role: `cut` },
        { role: `copy` },
        { role: `paste` },
        ...(isMac
          ? [
              { role: `pasteAndMatchStyle` as const },
              { role: `delete` as const },
            ]
          : [{ role: `delete` as const }]),
        { role: `selectAll` },
        { type: `separator` },
        {
          label: `Find in Pane…`,
          accelerator: `CommandOrControl+F`,
          click: () => sendCommand(`open-find`),
        },
        {
          label: `Find Next`,
          accelerator: `CommandOrControl+G`,
          click: () => sendCommand(`find-next`),
        },
        {
          label: `Find Previous`,
          accelerator: `Shift+CommandOrControl+G`,
          click: () => sendCommand(`find-previous`),
        },
      ],
    },
    {
      label: `View`,
      submenu: [
        {
          label: `Toggle Sidebar`,
          accelerator: `CommandOrControl+B`,
          click: () => sendCommand(`toggle-sidebar`),
        },
        {
          label: `Search Sessions…`,
          accelerator: `CommandOrControl+K`,
          click: () => sendCommand(`open-search`),
        },
        { type: `separator` },
        {
          label: `Split Right`,
          accelerator: `CommandOrControl+D`,
          click: () => sendCommand(`split-right`),
        },
        {
          label: `Split Down`,
          accelerator: `Shift+CommandOrControl+D`,
          click: () => sendCommand(`split-down`),
        },
        {
          label: `Cycle Tile`,
          accelerator: `CommandOrControl+\\`,
          click: () => sendCommand(`cycle-tile`),
        },
        { type: `separator` },
        { role: `togglefullscreen` },
        { role: `resetZoom` },
        { role: `zoomIn` },
        { role: `zoomOut` },
        { type: `separator` },
        { role: `reload` },
        { role: `forceReload` },
        { role: `toggleDevTools` },
      ],
    },
    {
      label: `Window`,
      submenu: [
        { role: `minimize` },
        { role: `zoom` },
        ...(isMac
          ? [{ type: `separator` as const }, { role: `front` as const }]
          : [{ role: `close` as const }]),
        ...(liveWindows.length > 0
          ? ([
              { type: `separator` },
              ...liveWindows.map(
                (win): Electron.MenuItemConstructorOptions => ({
                  label: windowDisplayLabel(win),
                  type: `checkbox`,
                  checked: win === focused,
                  click: () => {
                    if (win.isDestroyed()) return
                    if (win.isMinimized()) win.restore()
                    win.show()
                    win.focus()
                  },
                })
              ),
            ] as Array<Electron.MenuItemConstructorOptions>)
          : []),
      ],
    },
    {
      label: `Help`,
      submenu: [
        {
          label: `About ${APP_DISPLAY_NAME}`,
          click: () => showAboutDialog(),
        },
        { type: `separator` },
        {
          label: `Electric Documentation`,
          click: () => {
            void shell.openExternal(`https://electric-sql.com/docs/agents`)
          },
        },
        {
          label: `Electric on GitHub`,
          click: () => {
            void shell.openExternal(`https://github.com/electric-sql/electric`)
          },
        },
        { type: `separator` },
        {
          label: `Report an Issue`,
          click: () => {
            void shell.openExternal(
              `https://github.com/electric-sql/electric/issues/new`
            )
          },
        },
      ],
    },
  ]
}

function buildApplicationMenu(): void {
  const template = buildApplicationMenuTemplate()

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function popupApplicationMenuSection(
  win: BrowserWindow,
  section: DesktopMenuSection,
  bounds: DesktopMenuPopupBounds,
  state: DesktopMenuState
): void {
  const item = buildApplicationMenuTemplate().find(
    (candidate) => candidate.label === section
  )
  if (!item || !Array.isArray(item.submenu)) return

  Menu.buildFromTemplate(applyDesktopMenuState(item.submenu, state)).popup({
    window: win,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y + bounds.height),
  })
}

function popupAppIconMenu(
  win: BrowserWindow,
  bounds: DesktopMenuPopupBounds
): void {
  Menu.buildFromTemplate([
    {
      label: `About ${APP_DISPLAY_NAME}`,
      click: () => showAboutDialog(),
    },
    {
      label: `Check for Updates…`,
      enabled: false,
    },
  ]).popup({
    window: win,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y + bounds.height),
  })
}

function applyDesktopMenuState(
  items: Array<Electron.MenuItemConstructorOptions>,
  state: DesktopMenuState
): Array<Electron.MenuItemConstructorOptions> {
  const enabledByLabel = new Map<string, boolean>([
    [`Close Tile`, state.canCloseTile],
    [`Find in Pane…`, state.hasActiveTile],
    [`Find Next`, state.hasActiveTile],
    [`Find Previous`, state.hasActiveTile],
    [`Split Right`, state.canSplitTile],
    [`Split Down`, state.canSplitTile],
    [`Cycle Tile`, state.canCycleTile],
  ])

  return items.map((item) => {
    const next = { ...item }
    if (typeof item.label === `string` && enabledByLabel.has(item.label)) {
      next.enabled = enabledByLabel.get(item.label)
    }
    if (Array.isArray(item.submenu)) {
      next.submenu = applyDesktopMenuState(item.submenu, state)
    }
    return next
  })
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
