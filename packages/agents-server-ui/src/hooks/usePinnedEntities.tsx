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

  const togglePin = useCallback(
    (url: string) => {
      const next = pinnedUrls.includes(url)
        ? pinnedUrls.filter((u) => u !== url)
        : [...pinnedUrls, url]
      setPinnedUrls(next)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    },
    [pinnedUrls]
  )

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
