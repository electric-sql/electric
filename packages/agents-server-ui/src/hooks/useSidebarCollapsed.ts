import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = `electric-agents-ui.sidebar.collapsed`

function readInitial(): boolean {
  if (typeof window === `undefined`) return false
  return window.localStorage.getItem(STORAGE_KEY) === `1`
}

/**
 * Top-level sidebar visibility, persisted to `localStorage`.
 *
 * `collapsed = true` means the sidebar is fully hidden (no icon rail);
 * the main content takes the full viewport. Toggle via the top-bar
 * button or the global `⌘B` / `Ctrl+B` hotkey.
 */
export function useSidebarCollapsed(): {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
  toggle: () => void
} {
  const [collapsed, setCollapsedState] = useState<boolean>(readInitial)

  useEffect(() => {
    if (typeof window === `undefined`) return
    window.localStorage.setItem(STORAGE_KEY, collapsed ? `1` : `0`)
  }, [collapsed])

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
  }, [])

  const toggle = useCallback(() => {
    setCollapsedState((prev) => !prev)
  }, [])

  return { collapsed, setCollapsed, toggle }
}
