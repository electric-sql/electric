import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Icon, IconButton, Tooltip } from '../ui'
import { isMacPlatform } from '../hooks/useHotkey'
import type { DesktopNavigationState } from '../lib/server-connection'
import styles from './DesktopHistoryButtons.module.css'

const INITIAL_STATE: DesktopNavigationState = {
  canGoBack: false,
  canGoForward: false,
}

export function DesktopHistoryButtons(): React.ReactElement {
  const [navigationState, setNavigationState] =
    useState<DesktopNavigationState>(INITIAL_STATE)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getNavigationState) return

    void api.getNavigationState().then(setNavigationState)
    return api.onNavigationStateChanged?.(setNavigationState)
  }, [])

  const navigate = (direction: `back` | `forward`): void => {
    void window.electronAPI?.navigateHistory?.(direction)
  }

  const backShortcut = isMacPlatform() ? `⌘[` : `Alt+Left`
  const forwardShortcut = isMacPlatform() ? `⌘]` : `Alt+Right`

  return (
    <span className={styles.historyButtons}>
      <Tooltip content="Back" shortcut={backShortcut}>
        <IconButton
          variant="ghost"
          tone="neutral"
          size={1}
          className={styles.historyButton}
          onClick={() => navigate(`back`)}
          disabled={!navigationState.canGoBack}
          aria-label="Back"
        >
          <Icon icon={ChevronLeft} size={3} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Forward" shortcut={forwardShortcut}>
        <IconButton
          variant="ghost"
          tone="neutral"
          size={1}
          className={styles.historyButton}
          onClick={() => navigate(`forward`)}
          disabled={!navigationState.canGoForward}
          aria-label="Forward"
        >
          <Icon icon={ChevronRight} size={3} />
        </IconButton>
      </Tooltip>
    </span>
  )
}
