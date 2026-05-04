import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface PinnedEntitiesState {
  pinnedUrls: Array<string>
  togglePin: (url: string) => void
}

const PinnedEntitiesContext = createContext<PinnedEntitiesState | null>(null)

const STORAGE_KEY = `electric-agents-pinned-entities`

export function PinnedEntitiesProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [pinnedUrls, setPinnedUrls] = useState<Array<string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? `[]`)
    } catch {
      return []
    }
  })

  // Functional updater keeps `togglePin`'s identity stable across
  // renders. The previous implementation closed over `pinnedUrls`,
  // so its reference changed every time *any* pin flipped — that
  // ripped through memoised SidebarTree/Row props and re-rendered
  // the whole sidebar on each toggle.
  const togglePin = useCallback((url: string) => {
    setPinnedUrls((prev) => {
      const next = prev.includes(url)
        ? prev.filter((u) => u !== url)
        : [...prev, url]
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Ignore quota / private-mode errors — pin state is
        // recoverable, throwing here would leave the UI inconsistent.
      }
      return next
    })
  }, [])

  return (
    <PinnedEntitiesContext.Provider value={{ pinnedUrls, togglePin }}>
      {children}
    </PinnedEntitiesContext.Provider>
  )
}

export function usePinnedEntities(): PinnedEntitiesState {
  const ctx = useContext(PinnedEntitiesContext)
  if (!ctx)
    throw new Error(`usePinnedEntities must be inside PinnedEntitiesProvider`)
  return ctx
}
