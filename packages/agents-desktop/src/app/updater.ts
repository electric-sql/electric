import { app, BrowserWindow, dialog, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { APP_DISPLAY_NAME, ELECTRIC_GITHUB_URL } from '../shared/constants'

const RELEASES_URL = `${ELECTRIC_GITHUB_URL}/releases`

// macOS auto-install via Squirrel.Mac requires the app to be Developer-ID
// signed. Until phase 2 (signing + notarization in CI), surface updates on
// macOS as a notification that opens the releases page in the browser.
const MAC_AUTO_INSTALL_SUPPORTED = false

const STARTUP_CHECK_DELAY_MS = 10_000

export type DesktopUpdater = {
  initialize: () => void
  checkForUpdates: (options: { triggeredManually: boolean }) => Promise<void>
}

export type DesktopUpdaterDeps = {
  showOrCreateWindow: () => void
}

type CheckMode = `auto` | `manual`

const updaterLogger = {
  info: (message: unknown) => console.info(`[agents-desktop:updater]`, message),
  warn: (message: unknown) => console.warn(`[agents-desktop:updater]`, message),
  error: (message: unknown) =>
    console.error(`[agents-desktop:updater]`, message),
  debug: (_message: unknown) => {
    // electron-updater's debug stream is very chatty; drop it.
  },
}

export function createDesktopUpdater(deps: DesktopUpdaterDeps): DesktopUpdater {
  let initialized = false
  // Tracks which mode triggered the in-flight check so event handlers can
  // decide whether to show user-facing dialogs (manual) or stay silent (auto).
  let activeMode: CheckMode | null = null
  let checkInFlight: Promise<void> | null = null
  // electron-updater caches downloads and re-fires `update-downloaded` if
  // `downloadUpdate()` is called twice for the same version (e.g. a manual
  // Download click overlaps with the background auto check). Track which
  // version we already triggered a download for and which version's "ready"
  // dialog we already showed, so overlapping flows don't stack duplicates.
  let downloadStartedVersion: string | null = null
  let promptedDownloadedVersion: string | null = null

  function attachEventHandlers(): void {
    autoUpdater.logger = updaterLogger
    // Ask the user before pulling down a potentially large installer.
    autoUpdater.autoDownload = false
    // On macOS we never auto-install in phase 1; on Win/Linux we let the
    // installer run on next quit if the user dismisses the restart prompt.
    autoUpdater.autoInstallOnAppQuit =
      process.platform !== `darwin` || MAC_AUTO_INSTALL_SUPPORTED

    autoUpdater.on(`error`, (error) => {
      console.error(`[agents-desktop:updater] update error:`, error)
      setDownloadProgressBar(null)
      if (activeMode === `manual`) {
        void showMessageBox({
          type: `error`,
          title: `${APP_DISPLAY_NAME} updates`,
          message: `Couldn't check for updates`,
          detail:
            (error instanceof Error ? error.message : String(error)) ||
            `Unknown error`,
          buttons: [`OK`],
          defaultId: 0,
        })
      }
    })

    autoUpdater.on(`update-available`, (info) => {
      void handleUpdateAvailable(info)
    })

    autoUpdater.on(`update-not-available`, () => {
      if (activeMode === `manual`) {
        void showMessageBox({
          type: `info`,
          title: `${APP_DISPLAY_NAME} updates`,
          message: `You're up to date`,
          detail: `${APP_DISPLAY_NAME} ${app.getVersion()} is the latest version.`,
          buttons: [`OK`],
          defaultId: 0,
        })
      }
    })

    autoUpdater.on(`download-progress`, (progress) => {
      const percent = Math.round(progress.percent ?? 0)
      console.info(`[agents-desktop:updater] downloading update: ${percent}%`)
      setDownloadProgressBar(progress.percent ?? 0)
    })

    autoUpdater.on(`update-downloaded`, (info) => {
      setDownloadProgressBar(null)
      void handleUpdateDownloaded(info)
    })
  }

  function setDownloadProgressBar(percent: number | null): void {
    // `progress` of -1 clears the dock/taskbar indicator; otherwise a 0–1
    // fraction. Apply to every live window so the indicator shows up
    // regardless of which window has focus.
    const value =
      percent === null ? -1 : Math.max(0, Math.min(1, percent / 100))
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setProgressBar(value)
    }
  }

  async function startDownload(version: string): Promise<void> {
    if (downloadStartedVersion === version) return
    downloadStartedVersion = version
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      console.error(`[agents-desktop:updater] download failed:`, error)
      // Allow a retry on the next check.
      downloadStartedVersion = null
      setDownloadProgressBar(null)
    }
  }

  function getParentWindow(): BrowserWindow | undefined {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed()) return focused
    const any = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
    if (any) return any
    // No live window — surface one before showing the dialog so the user
    // sees a modal anchored to the app rather than a stray system alert.
    deps.showOrCreateWindow()
    return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
  }

  async function showMessageBox(
    options: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> {
    const parent = getParentWindow()
    return parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options)
  }

  function canAutoInstall(): boolean {
    // Squirrel.Mac requires a Developer-ID signature to swap the bundle, so
    // on unsigned macOS we operate as a notifier: we don't download the
    // installer (it'd just be discarded — the user has to grab it from the
    // browser to install it anyway), we just point them at the releases page.
    return process.platform !== `darwin` || MAC_AUTO_INSTALL_SUPPORTED
  }

  async function handleUpdateAvailable(info: UpdateInfo): Promise<void> {
    if (!canAutoInstall()) {
      // Notifier-only mode: skip download, prompt on manual check only.
      // (Auto checks stay silent so they don't pop dialogs while the user
      // is mid-task; they'll find out next time they manually check.)
      if (activeMode === `manual`) {
        await promptOpenReleasesPage(info.version)
      }
      return
    }

    if (activeMode !== `manual`) {
      // Background check: download silently; prompt on update-downloaded.
      void startDownload(info.version)
      return
    }

    // Manual flow: a prior auto check may have already kicked off the
    // download — skip straight to a confirmation in that case.
    if (downloadStartedVersion === info.version) {
      void showMessageBox({
        type: `info`,
        title: `${APP_DISPLAY_NAME} updates`,
        message: `${APP_DISPLAY_NAME} ${info.version} is downloading`,
        detail: `You'll be notified when it's ready to install.`,
        buttons: [`OK`],
        defaultId: 0,
      })
      return
    }

    const { response } = await showMessageBox({
      type: `info`,
      title: `${APP_DISPLAY_NAME} updates`,
      message: `A new version is available`,
      detail: `${APP_DISPLAY_NAME} ${info.version} is available. You're currently on ${app.getVersion()}.`,
      buttons: [`Download`, `Later`],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return

    void startDownload(info.version)
    // Confirm so the user knows the click registered — the download runs in
    // the background and only surfaces UI again when it finishes.
    void showMessageBox({
      type: `info`,
      title: `${APP_DISPLAY_NAME} updates`,
      message: `Downloading ${APP_DISPLAY_NAME} ${info.version}`,
      detail: `Download progress shows in the dock. You'll be notified when it's ready to install.`,
      buttons: [`OK`],
      defaultId: 0,
    })
  }

  async function promptOpenReleasesPage(version: string): Promise<void> {
    const { response } = await showMessageBox({
      type: `info`,
      title: `${APP_DISPLAY_NAME} updates`,
      message: `${APP_DISPLAY_NAME} ${version} is available`,
      detail: `Open the releases page to download and install the new version.`,
      buttons: [`Open releases page`, `Later`],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      void shell.openExternal(RELEASES_URL)
    }
  }

  async function handleUpdateDownloaded(info: UpdateInfo): Promise<void> {
    // Only fires on platforms that can auto-install; unsigned macOS skips the
    // download in `handleUpdateAvailable`, so it never reaches this path.
    if (promptedDownloadedVersion === info.version) return
    promptedDownloadedVersion = info.version

    const { response } = await showMessageBox({
      type: `info`,
      title: `${APP_DISPLAY_NAME} updates`,
      message: `${APP_DISPLAY_NAME} ${info.version} is ready to install`,
      detail: `Restart ${APP_DISPLAY_NAME} now to apply the update.`,
      buttons: [`Restart now`, `Later`],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  }

  function initialize(): void {
    if (initialized) return
    initialized = true

    if (!app.isPackaged) {
      console.info(
        `[agents-desktop:updater] running unpackaged; auto-update disabled`
      )
      return
    }

    attachEventHandlers()

    setTimeout(() => {
      void checkForUpdates({ triggeredManually: false })
    }, STARTUP_CHECK_DELAY_MS)
  }

  async function checkForUpdates(options: {
    triggeredManually: boolean
  }): Promise<void> {
    const mode: CheckMode = options.triggeredManually ? `manual` : `auto`

    if (!app.isPackaged) {
      if (mode === `manual`) {
        await showMessageBox({
          type: `info`,
          title: `${APP_DISPLAY_NAME} updates`,
          message: `Updates are only available in packaged builds`,
          detail: `You're running ${APP_DISPLAY_NAME} from source.`,
          buttons: [`OK`],
          defaultId: 0,
        })
      }
      return
    }

    // Coalesce concurrent checks — manual click during an auto check just
    // attaches to the in-flight promise (and upgrades to manual mode so
    // dialogs fire when it resolves).
    if (checkInFlight) {
      if (mode === `manual`) activeMode = `manual`
      return checkInFlight
    }

    activeMode = mode
    checkInFlight = (async () => {
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        console.error(`[agents-desktop:updater] check failed:`, error)
      } finally {
        checkInFlight = null
        activeMode = null
      }
    })()

    return checkInFlight
  }

  return { initialize, checkForUpdates }
}
