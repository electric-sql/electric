import { BrowserWindow, app, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { APP_DISPLAY_NAME, APP_WEBSITE_URL } from '../shared/constants'
import { APP_ICON_PATH } from '../shared/paths'

export type AboutDialogDeps = {
  getAboutWindow: () => BrowserWindow | null
  setAboutWindow: (win: BrowserWindow | null) => void
}

export function showAboutDialog(deps: AboutDialogDeps): void {
  const existing = deps.getAboutWindow()
  if (existing && !existing.isDestroyed()) {
    existing.focus()
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
      <a href="${APP_WEBSITE_URL}/" target="_blank" rel="noreferrer">electric.ax/agents</a>
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
  deps.setAboutWindow(win)
  win.setMenuBarVisibility(false)
  win.on(`closed`, () => {
    if (deps.getAboutWindow() === win) {
      deps.setAboutWindow(null)
    }
  })
  win.once(`ready-to-show`, () => win.show())
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
