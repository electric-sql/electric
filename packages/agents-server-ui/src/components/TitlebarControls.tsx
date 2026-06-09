import { PanelLeft, PanelLeftClose, Search } from 'lucide-react'
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed'
import { useSearchPalette } from '../hooks/useSearchPalette'
import { modKeyLabel } from '../lib/keyLabels'
import { Icon, IconButton, Tooltip } from '../ui'
import { DesktopHistoryButtons } from './DesktopHistoryButtons'
import styles from './TitlebarControls.module.css'

/**
 * Stationary titlebar controls for web and macOS desktop.
 *
 * The workspace/sidebar can slide underneath during collapse animations, but
 * this cluster stays pinned so controls do not jump between the sidebar header
 * and the main tile header.
 */
export function TitlebarControls(): React.ReactElement {
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed()
  const search = useSearchPalette()

  return (
    <div className={styles.controls} data-sidebar-control-surface="true">
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
      <DesktopHistoryButtons />
    </div>
  )
}
