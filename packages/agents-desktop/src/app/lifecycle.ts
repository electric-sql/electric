import { app, nativeImage, nativeTheme, session } from 'electron'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { DesktopAppContext } from './context'
import * as RuntimeLifecycle from '../runtime/lifecycle'
import { APP_DISPLAY_NAME, APP_WEBSITE_URL } from '../shared/constants'
import { APP_ICON_PATH, secretsPath } from '../shared/paths'
import { settingsPath } from '../settings/store'
import type { DesktopAppearance } from '../shared/types'

export function configureRuntimeEnvironment(): void {
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

export async function quitApp(deps: {
  ctx: DesktopAppContext
  stopDiscoveryLoop: () => void
  runtimeLifecycleDeps: RuntimeLifecycle.RuntimeLifecycleDeps
}): Promise<void> {
  if (deps.ctx.shell.isQuitting) return
  deps.ctx.shell.isQuitting = true
  deps.stopDiscoveryLoop()
  await RuntimeLifecycle.stopExistingRuntime(deps.runtimeLifecycleDeps).catch(
    () => {}
  )
  app.quit()
}

export async function clearAllLocalDataAndRelaunch(deps: {
  ctx: DesktopAppContext
  quitApp: () => Promise<void>
}): Promise<void> {
  await deps.ctx.getCloudAuth().signOut()
  await deps.ctx.getCloudAgentServers().stop()
  await Promise.all([
    session.defaultSession.clearStorageData(),
    session.defaultSession.clearCache(),
    rm(settingsPath(), { force: true }),
    rm(secretsPath(), { force: true }),
  ])
  deps.ctx.services.secretStore = null
  app.relaunch()
  await deps.quitApp()
}

export function refreshNativeTitleBars(ctx: DesktopAppContext): void {
  const symbolColor = nativeTheme.shouldUseDarkColors ? `#ededee` : `#1f2328`
  for (const win of ctx.windows) {
    win.setTitleBarOverlay?.({
      color: `#00000000`,
      symbolColor,
      height: 34,
    })
  }
}

export function applyNativeAppearance(
  ctx: DesktopAppContext,
  appearance: DesktopAppearance
): void {
  nativeTheme.themeSource = appearance
  refreshNativeTitleBars(ctx)
}

export function configureNativeAppMetadata(): void {
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion() || `dev`,
    version: app.getVersion() || `dev`,
    copyright: `© ${new Date().getFullYear()} Electric DB Limited`,
    website: APP_WEBSITE_URL,
    iconPath: APP_ICON_PATH,
    credits: `The durable runtime for long-lived agents.`,
  })

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
}
