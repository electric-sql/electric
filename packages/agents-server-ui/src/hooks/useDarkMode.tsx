import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const STORAGE_KEY = `electric-agents-ui.dark-mode`

type DarkModeContextValue = {
  darkMode: boolean
  toggleDarkMode: () => void
}

const DarkModeContext = createContext<DarkModeContextValue | null>(null)

function readInitial(): boolean {
  if (typeof window === `undefined`) return false
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === `true`) return true
  if (stored === `false`) return false
  return window.matchMedia?.(`(prefers-color-scheme: dark)`).matches ?? false
}

export function DarkModeProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [darkMode, setDarkMode] = useState<boolean>(readInitial)

  useEffect(() => {
    document.documentElement.classList.toggle(`dark`, darkMode)
  }, [darkMode])

  const toggleDarkMode = useCallback(() => {
    setDarkMode((current) => {
      const next = !current
      window.localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ darkMode, toggleDarkMode }),
    [darkMode, toggleDarkMode]
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
