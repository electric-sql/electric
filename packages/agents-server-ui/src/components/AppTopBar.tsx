import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { PanelLeft, PanelLeftClose, Search } from 'lucide-react'
import { IconButton, Kbd, TopBar } from '../ui'
import { isMacPlatform } from '../hooks/useHotkey'
import styles from './AppTopBar.module.css'

/**
 * Slot system for the global top bar.
 *
 * `<TopBarTitle>` and `<TopBarActions>` are render-anywhere components
 * that push their children into the corresponding slots in the global
 * `<AppTopBar>`. This keeps `RootLayout` declarative — each route just
 * renders its title + actions inside its own tree, and the top bar
 * picks them up automatically.
 */

type TopBarSlots = {
  title: ReactNode | null
  actions: ReactNode | null
}

type TopBarSlotsApi = {
  setSlot: (key: keyof TopBarSlots, node: ReactNode | null) => void
}

const TopBarSlotsValueCtx = createContext<TopBarSlots>({
  title: null,
  actions: null,
})
const TopBarSlotsApiCtx = createContext<TopBarSlotsApi>({
  setSlot: () => {},
})

export function TopBarSlotsProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [slots, setSlots] = useState<TopBarSlots>({
    title: null,
    actions: null,
  })
  const setSlot = useCallback<TopBarSlotsApi[`setSlot`]>((key, node) => {
    setSlots((prev) => (prev[key] === node ? prev : { ...prev, [key]: node }))
  }, [])
  return (
    <TopBarSlotsApiCtx.Provider value={{ setSlot }}>
      <TopBarSlotsValueCtx.Provider value={slots}>
        {children}
      </TopBarSlotsValueCtx.Provider>
    </TopBarSlotsApiCtx.Provider>
  )
}

function useTopBarSlot(key: keyof TopBarSlots, node: ReactNode): null {
  const { setSlot } = useContext(TopBarSlotsApiCtx)
  // useLayoutEffect so the slot updates synchronously with route renders
  // (avoids a one-frame flash of the previous route's title/actions).
  useLayoutEffect(() => {
    setSlot(key, node)
    return () => setSlot(key, null)
  }, [key, node, setSlot])
  return null
}

export function TopBarTitle({
  children,
}: {
  children: ReactNode
}): React.ReactElement | null {
  return useTopBarSlot(`title`, children)
}

export function TopBarActions({
  children,
}: {
  children: ReactNode
}): React.ReactElement | null {
  return useTopBarSlot(`actions`, children)
}

export function AppTopBar({
  collapsed,
  onToggleSidebar,
  onOpenSearch,
}: {
  collapsed: boolean
  onToggleSidebar: () => void
  onOpenSearch: () => void
}): React.ReactElement {
  const slots = useContext(TopBarSlotsValueCtx)
  const modKey = isMacPlatform() ? `⌘` : `Ctrl`
  return (
    <TopBar
      titleAlign="start"
      start={
        <>
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            onClick={onToggleSidebar}
            aria-label={collapsed ? `Show sidebar` : `Hide sidebar`}
            className={styles.toggleBtn}
          >
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </IconButton>
          <button
            type="button"
            onClick={onOpenSearch}
            className={styles.searchBtn}
            aria-label="Search sessions"
          >
            <Search size={12} />
            <span className={styles.searchLabel}>Search</span>
            <Kbd>
              {modKey}
              {`K`}
            </Kbd>
          </button>
        </>
      }
      title={slots.title}
      end={slots.actions}
    />
  )
}
