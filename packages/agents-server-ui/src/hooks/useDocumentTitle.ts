import { useEffect } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { useWorkspace } from './useWorkspace'

const APP_NAME = `Electric Agents`

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

  const { data: matches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || !activeEntityUrl) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => e.url === activeEntityUrl)
        .limit(1)
    },
    [entitiesCollection, activeEntityUrl]
  )
  const entity = matches[0]

  useEffect(() => {
    if (typeof document === `undefined`) return
    if (!activeEntityUrl) {
      document.title = APP_NAME
      return
    }
    const sessionLabel = entity
      ? getEntityDisplayTitle(entity).title
      : activeEntityUrl.replace(/^\//, ``)
    document.title = `${sessionLabel} — ${APP_NAME}`
  }, [activeEntityUrl, entity])
}
