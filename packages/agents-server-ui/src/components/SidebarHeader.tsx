import { PanelLeftClose, Search } from 'lucide-react'
import { IconButton } from '../ui'
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed'
import { useSearchPalette } from '../hooks/useSearchPalette'
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
      <IconButton
        variant="ghost"
        tone="neutral"
        size={1}
        onClick={toggleSidebar}
        aria-label="Hide sidebar"
      >
        <PanelLeftClose size={16} />
      </IconButton>
      <IconButton
        variant="ghost"
        tone="neutral"
        size={1}
        onClick={search.open}
        aria-label="Search sessions"
      >
        <Search size={16} />
      </IconButton>
    </div>
  )
}
