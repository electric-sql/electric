import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const STORAGE_KEY = `electric-agents-chat.dark-mode`

export type ThemePreference = `light` | `dark` | `system`

type DarkModeContextValue = {
  darkMode: boolean
  preference: ThemePreference
  cyclePreference: () => void
}

const DarkModeContext = createContext<DarkModeContextValue | null>(null)

function readInitialPreference(): ThemePreference {
  if (typeof window === `undefined`) return `system`
  const stored = window.localStorage.getItem(STORAGE_KEY)
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

  useEffect(() => {
    document.documentElement.classList.toggle(`dark`, darkMode)
  }, [darkMode])

  const cyclePreference = useCallback(() => {
    setPreference((current) => {
      const next = cycleOrder[current]
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ darkMode, preference, cyclePreference }),
    [darkMode, preference, cyclePreference]
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
