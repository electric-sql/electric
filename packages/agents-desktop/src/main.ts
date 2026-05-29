import * as AppLifecycle from './app/lifecycle'
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

async function main(): Promise<void> {
  // Make sure macOS shows the product name everywhere (about menu,
  // dock tooltip, default window title) instead of the npm package id.
  app.setName(APP_DISPLAY_NAME)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on(`second-instance`, () => {
    desktopController?.showOrCreateWindow()
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
  controller.createWindow()
  controller.connectConfiguredServers()
  controller.startDiscoveryLoop()
}

void main()
