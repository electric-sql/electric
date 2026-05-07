import { PanelLeftClose, Search } from 'lucide-react'
import { Icon, IconButton, Tooltip } from '../ui'
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed'
import { useSearchPalette } from '../hooks/useSearchPalette'
import { modKeyLabel } from '../lib/keyLabels'
import styles from './SidebarHeader.module.css'

/**
 * Sidebar's own header row. Hosts the sidebar collapse button + the
 * search trigger when the sidebar is open. When the sidebar collapses,
 * these affordances move into `<MainHeader>` instead so the chat
 * column still has a way to toggle the sidebar / open search.
 */
export function SidebarHeader(): React.ReactElement {
  const { toggle: toggleSidebar } = useSidebarCollapsed()
  const search = useSearchPalette()
  return (
    <div className={styles.header}>
      <Tooltip content="Hide sidebar" shortcut={modKeyLabel(`b`)}>
        <IconButton
          variant="ghost"
          tone="neutral"
          size={1}
          onClick={toggleSidebar}
          aria-label="Hide sidebar"
        >
          <Icon icon={PanelLeftClose} size={3} />
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
  )
}
