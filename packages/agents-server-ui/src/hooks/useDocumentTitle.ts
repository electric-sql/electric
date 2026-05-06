import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { useWorkspace } from './useWorkspace'

const APP_NAME = `Electric Agents`

const SETTINGS_CATEGORY_LABELS: Record<string, string> = {
  general: `General`,
  appearance: `Appearance`,
  'local-runtime': `Local Runtime`,
}

/**
 * Keeps `document.title` in sync with the active tile's entity so the
 * browser tab / Electron window title reads as e.g. "Build the report
 * — Electric Agents". In the Electron desktop build the main process
 * listens to `page-title-updated` on each window and uses the title
 * to label that window in the Window menu — so changing this hook
 * also changes how windows are named in the menu bar.
 *
 * Falls back to just the app name when there's no active entity (the
 * empty workspace, the new-session tile, etc.) so the chrome stays
 * clean.
 */
export function useDocumentTitle(): void {
  const { helpers } = useWorkspace()
  const activeEntityUrl = helpers.activeTile?.entityUrl ?? null
  const { entitiesCollection } = useElectricAgents()
  const location = useLocation()
  const settingsLabel = parseSettingsLabel(location.pathname)

  const { data: matches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || !activeEntityUrl) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, activeEntityUrl))
    },
    [entitiesCollection, activeEntityUrl]
  )
  const entity = matches[0]

  useEffect(() => {
    if (typeof document === `undefined`) return
    if (settingsLabel) {
      document.title = `${settingsLabel} — Settings — ${APP_NAME}`
      return
    }
    if (!activeEntityUrl) {
      document.title = APP_NAME
      return
    }
    const sessionLabel = entity
      ? getEntityDisplayTitle(entity).title
      : activeEntityUrl.replace(/^\//, ``)
    document.title = `${sessionLabel} — ${APP_NAME}`
  }, [activeEntityUrl, entity, settingsLabel])
}

/**
 * Reads `/settings/<category>` off the URL and returns a human label
 * for the chrome (`General`, `Appearance`, `Local Runtime`). Returns
 * `null` for any non-settings route so the entity-based title kicks
 * in instead.
 */
function parseSettingsLabel(pathname: string): string | null {
  const match = pathname.match(/^\/settings(?:\/([^/?]+))?/)
  if (!match) return null
  const category = match[1] ?? `general`
  return SETTINGS_CATEGORY_LABELS[category] ?? `Settings`
}
