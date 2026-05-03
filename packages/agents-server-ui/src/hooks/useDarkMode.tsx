import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const STORAGE_KEY = `electric-agents-ui.dark-mode`

export type ThemePreference = `light` | `dark` | `system`

type DarkModeContextValue = {
  darkMode: boolean
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
  cyclePreference: () => void
}

const DarkModeContext = createContext<DarkModeContextValue | null>(null)

function readInitialPreference(): ThemePreference {
  if (typeof window === `undefined`) return `system`
  const stored = window.localStorage.getItem(STORAGE_KEY)
  // Migrate legacy boolean strings written before the 3-state toggle
  if (stored === `true` || stored === `dark`) return `dark`
  if (stored === `false` || stored === `light`) return `light`
  return `system`
}

function systemPrefersDark(): boolean {
  if (typeof window === `undefined`) return false
  return window.matchMedia?.(`(prefers-color-scheme: dark)`).matches ?? false
}

const cycleOrder: Record<ThemePreference, ThemePreference> = {
  light: `dark`,
  dark: `system`,
  system: `light`,
}

export function DarkModeProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [preference, setPreference] = useState<ThemePreference>(
    readInitialPreference
  )
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => {
    if (typeof window === `undefined`) return
    const mql = window.matchMedia(`(prefers-color-scheme: dark)`)
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mql.addEventListener(`change`, onChange)
    return () => mql.removeEventListener(`change`, onChange)
  }, [])

  const darkMode = preference === `system` ? systemDark : preference === `dark`

  // Note: applying the resolved theme to <html> is owned by the
  // design-system <ThemeProvider> (it sets `data-theme="dark|light"`).

  const cyclePreference = useCallback(() => {
    setPreference((current) => {
      const next = cycleOrder[current]
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  const setExplicit = useCallback((next: ThemePreference) => {
    setPreference(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const value = useMemo(
    () => ({
      darkMode,
      preference,
      setPreference: setExplicit,
      cyclePreference,
    }),
    [darkMode, preference, setExplicit, cyclePreference]
  )

  return (
    <DarkModeContext.Provider value={value}>
      {children}
    </DarkModeContext.Provider>
  )
}

export function useDarkModeContext(): DarkModeContextValue {
  const value = useContext(DarkModeContext)
  if (!value) {
    throw new Error(`useDarkModeContext must be used inside DarkModeProvider`)
  }
  return value
}
