import type { ReactNode } from 'react'
import { PanelLeft, Search } from 'lucide-react'
import { IconButton } from '../ui'
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed'
import { useSearchPalette } from '../hooks/useSearchPalette'
import styles from './MainHeader.module.css'

type MainHeaderProps = {
  title?: ReactNode
  actions?: ReactNode
}

/**
 * Header strip at the top of the main content column.
 *
 * When the sidebar is collapsed it grows the chrome buttons (sidebar
 * toggle + search) on the left so the user can still toggle the
 * sidebar / open the search palette without a global top bar. When the
 * sidebar is open those affordances live inside `<SidebarHeader>` and
 * the strip starts directly with the title.
 *
 * No border / divider — the strip shares a background with the column
 * body, matching Cursor / Codex chrome.
 */
export function MainHeader({
  title,
  actions,
}: MainHeaderProps): React.ReactElement {
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed()
  const search = useSearchPalette()

  return (
    <header className={styles.header}>
      {collapsed && (
        <span className={styles.chrome}>
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            onClick={toggleSidebar}
            aria-label="Show sidebar"
          >
            <PanelLeft size={16} />
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
        </span>
      )}
      <div className={styles.title}>{title}</div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
