import { PanelLeft, PanelLeftClose, Search } from 'lucide-react'
import { useSearchPalette } from '../hooks/useSearchPalette'
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed'
import { listTiles, useWorkspace } from '../hooks/useWorkspace'
import { modKeyLabel } from '../lib/keyLabels'
import { Icon, IconButton, Tooltip } from '../ui'
import styles from './DesktopTitleBar.module.css'
import type {
  DesktopMenuState,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
} from '../lib/server-connection'

const MENU_SECTIONS: ReadonlyArray<DesktopMenuSection> = [
  `File`,
  `Edit`,
  `View`,
  `Window`,
  `Help`,
]

/**
 * Windows/Linux desktop chrome modeled after VS Code/Cursor: a custom
 * renderer-painted app icon + menu strip that shares the row with
 * Electron's native window-controls overlay.
 */
export function DesktopTitleBar(): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed()
  const search = useSearchPalette()

  const tiles = listTiles(workspace.root)
  const menuState: DesktopMenuState = {
    hasActiveTile: helpers.activeTileId !== null,
    canCloseTile: tiles.length > 1 && helpers.activeTileId !== null,
    canSplitTile: helpers.activeTileId !== null,
    canCycleTile: tiles.length > 1,
  }

  const showMenu = (
    section: DesktopMenuSection,
    element: HTMLElement
  ): void => {
    const rect = element.getBoundingClientRect()
    const bounds: DesktopMenuPopupBounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }

    if (window.electronAPI?.showMenuSection) {
      void window.electronAPI.showMenuSection(section, bounds, menuState)
    }
  }

  const showAppMenu = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    const bounds: DesktopMenuPopupBounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }

    if (window.electronAPI?.showAppMenu) {
      void window.electronAPI.showAppMenu(bounds)
    }
  }

  return (
    <div className={styles.titleBar} aria-label="Application menu">
      <button
        type="button"
        className={styles.appMenuButton}
        onClick={(event) => showAppMenu(event.currentTarget)}
        aria-label="Application menu"
      >
        <span className={styles.appIcon} aria-hidden="true" />
      </button>
      <div className={styles.chrome}>
        <Tooltip
          content={collapsed ? `Show sidebar` : `Hide sidebar`}
          shortcut={modKeyLabel(`b`)}
        >
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            onClick={toggleSidebar}
            aria-label={collapsed ? `Show sidebar` : `Hide sidebar`}
          >
            <Icon icon={collapsed ? PanelLeft : PanelLeftClose} size={3} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Search sessions" shortcut={modKeyLabel(`k`)}>
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            onClick={search.open}
            aria-label="Search sessions"
          >
            <Icon icon={Search} size={3} />
          </IconButton>
        </Tooltip>
      </div>
      <nav className={styles.menu} aria-label="Application">
        {MENU_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className={styles.menuItem}
            onClick={(event) => showMenu(section, event.currentTarget)}
          >
            {section}
          </button>
        ))}
      </nav>
      <div className={styles.dragRegion} />
      <div className={styles.webWindowControls} aria-hidden="true">
        <span className={styles.minimize} />
        <span className={styles.maximize} />
        <span className={styles.close} />
      </div>
    </div>
  )
}
