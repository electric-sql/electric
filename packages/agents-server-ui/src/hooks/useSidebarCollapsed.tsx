import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = `electric-agents-ui.sidebar.collapsed`

function readInitial(): boolean {
  if (typeof window === `undefined`) return false
  return window.localStorage.getItem(STORAGE_KEY) === `1`
}

type SidebarCollapsedApi = {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
  toggle: () => void
}

const Ctx = createContext<SidebarCollapsedApi | null>(null)

/**
 * Provides app-wide sidebar visibility state, persisted to
 * `localStorage`. Mounted at the root of the app shell so every
 * consumer (sidebar, sidebar header, main header chrome) reads the
 * same value and a single ⌘B / button click flips them in sync.
 *
 * `collapsed = true` means the sidebar is fully hidden (no icon rail);
 * the main content takes the full viewport.
 */
export function SidebarCollapsedProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
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

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggle }),
    [collapsed, setCollapsed, toggle]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSidebarCollapsed(): SidebarCollapsedApi {
  const value = useContext(Ctx)
  if (!value) {
    throw new Error(
      `useSidebarCollapsed must be used inside SidebarCollapsedProvider`
    )
  }
  return value
}
