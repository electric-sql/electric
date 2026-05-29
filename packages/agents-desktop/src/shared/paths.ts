import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
export const PACKAGE_DIR = path.resolve(MODULE_DIR, `..`)
export const RESOURCE_DIR = app.isPackaged ? process.resourcesPath : PACKAGE_DIR
export const RENDERER_INDEX = app.isPackaged
  ? path.join(RESOURCE_DIR, `renderer`, `index.html`)
  : path.resolve(PACKAGE_DIR, `../agents-server-ui/dist-desktop/index.html`)
// Bundled `@electric-ax/agents` can't resolve its own skills dir; supply it explicitly.
export const AGENT_SKILLS_DIR = app.isPackaged
  ? path.join(RESOURCE_DIR, `agent-skills`)
  : path.resolve(PACKAGE_DIR, `../agents/skills`)
export const PRELOAD_PATH = path.resolve(MODULE_DIR, `preload.cjs`)
export const TRAY_ICON_PATH = path.join(
  RESOURCE_DIR,
  `assets`,
  `trayTemplate.png`
)
export const TRAY_ICON_2X_PATH = path.join(
  RESOURCE_DIR,
  `assets`,
  `trayTemplate@2x.png`
)
const APP_ICON_FILE =
  process.platform === `darwin` ? `icon-mac.png` : `icon.png`
export const APP_ICON_PATH = path.join(RESOURCE_DIR, `assets`, APP_ICON_FILE)

export function settingsPath(): string {
  return path.join(app.getPath(`userData`), `settings.json`)
}

export function secretsPath(): string {
  return path.join(app.getPath(`userData`), `secrets.json`)
}
