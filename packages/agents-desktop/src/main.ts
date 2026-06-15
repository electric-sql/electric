import * as AppLifecycle from './app/lifecycle'
import * as LoginItems from './app/login-items'
import {
  createDesktopMainController,
  type DesktopMainController,
} from './app/controller'
import { createDesktopAppContext } from './app/context'
import {
  APP_DISPLAY_NAME,
  DESKTOP_USER_DATA_DIR,
  IGNORE_CONNECTION_LIMIT_DOMAINS,
} from './shared/constants'
import { secretsPath } from './shared/paths'
import type { CloudAgentServersState } from './cloud/cloud-agent-servers'
import type { CloudAuthState } from './cloud/cloud-auth'
import { extractSessionDeepLinkFromArgv } from './shared/deep-link'
import { app, nativeTheme } from 'electron'
import fixPath from 'fix-path'
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

let desktopController: DesktopMainController | null = null

const desktopContext = createDesktopAppContext({
  secretsPath,
  onCloudAuthState: (next) => broadcastCloudAuthState(next),
  onCloudAgentServersState: (next) => broadcastCloudAgentServersState(next),
})
AppLifecycle.configureRuntimeEnvironment()

function broadcastCloudAuthState(next: CloudAuthState): void {
  desktopController?.broadcastCloudAuthState(next)
}

function broadcastCloudAgentServersState(next: CloudAgentServersState): void {
  desktopController?.broadcastCloudAgentServersState(next)
}

desktopController = createDesktopMainController(desktopContext)

// Claim the `electric-agents://` scheme so the OS routes deep links to us.
// In dev on Windows/Linux the OS must relaunch the actual dev binary, so we
// pass execPath + the entry script explicitly.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(`electric-agents`, process.execPath, [
    path.resolve(process.argv[1]!),
  ])
} else {
  app.setAsDefaultProtocolClient(`electric-agents`)
}

// `open-url` (macOS) can fire before the app is ready; queue until then.
let pendingDeepLink: string | null = null
function dispatchDeepLink(url: string): void {
  if (!app.isReady() || !desktopController) {
    pendingDeepLink = url
    return
  }
  desktopController.openSessionFromDeepLink(url)
}

app.on(`open-url`, (event, url) => {
  event.preventDefault()
  dispatchDeepLink(url)
})

async function main(): Promise<void> {
  // Make sure macOS shows the product name everywhere (about menu,
  // dock tooltip, default window title) instead of the npm package id.
  app.setName(APP_DISPLAY_NAME)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on(`second-instance`, (_event, argv) => {
    const deepLink = extractSessionDeepLinkFromArgv(argv)
    if (deepLink) {
      desktopController?.openSessionFromDeepLink(deepLink)
      return
    }
    if (LoginItems.shouldOpenWindowForSecondInstance(argv)) {
      desktopController?.showOrCreateWindow()
    }
  })

  app.on(`window-all-closed`, () => {
    // Keep the tray/menu bar runtime alive until the user explicitly quits.
  })

  app.on(`activate`, () => {
    desktopController?.showOrCreateWindow()
  })

  // Re-render the menu when focus changes so the Window submenu's
  // checkmark moves to the now-focused window.
  app.on(`browser-window-focus`, () =>
    desktopController?.buildApplicationMenu()
  )
  app.on(`browser-window-blur`, () => desktopController?.buildApplicationMenu())

  app.on(`before-quit`, (event) => {
    if (desktopContext.shell.isQuitting) return
    event.preventDefault()
    void desktopController?.quitApp()
  })

  await app.whenReady()
  const controller = desktopController
  if (!controller) {
    throw new Error(`Desktop controller was not initialized`)
  }
  AppLifecycle.configureRuntimeEnvironment()
  await controller.loadSettings()
  await controller.syncLaunchAtLoginSetting().catch((error) => {
    console.warn(`[agents-desktop] Failed to sync login item settings:`, error)
  })
  controller.registerIpcHandlers()
  await desktopContext.getCloudAuth().initialize()
  // Hydrate the per-tenant agents-token cache from `SecretStore`
  // BEFORE we install the webRequest hook so a window opening
  // straight onto a saved cloud server gets the auth headers added.
  const cloudTenantIds = desktopContext.settings.servers
    .filter((s) => s.source === `electric-cloud` && s.tenantId)
    .map((s) => s.tenantId as string)
  await desktopContext.getCloudAgentServers().hydrateTokens(cloudTenantIds)
  controller.installCloudAuthHeaderInjection()
  // Eagerly kick the cloud-agent-servers streams once on boot — the
  // CloudAuth subscriber handles subsequent sign-in/sign-out edges.
  // Safe to call when signed-out: `start()` no-ops without a token.
  void desktopContext.getCloudAgentServers().start()
  nativeTheme.on(`updated`, () =>
    AppLifecycle.refreshNativeTitleBars(desktopContext)
  )

  AppLifecycle.configureNativeAppMetadata()

  controller.createTray()
  controller.buildApplicationMenu()
  if (!LoginItems.isBackgroundLaunch()) {
    controller.createWindow()
  }
  controller.connectConfiguredServers()
  controller.startDiscoveryLoop()
  controller.initializeUpdater()

  // Windows/Linux cold start: the deep link is an argv entry. macOS cold
  // start: `open-url` already fired and stashed it in `pendingDeepLink`.
  const argvDeepLink = extractSessionDeepLinkFromArgv(process.argv)
  const coldStartLink = pendingDeepLink ?? argvDeepLink
  if (coldStartLink) {
    pendingDeepLink = null
    controller.openSessionFromDeepLink(coldStartLink)
  }
}

void main()
