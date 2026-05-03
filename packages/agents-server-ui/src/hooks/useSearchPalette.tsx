import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Session-search palette (⌘K) — open/close state only.
 *
 * Phase 1 ships the provider + hook so the global top-bar search button
 * has somewhere to call. Phase 4 mounts the actual `<SearchPalette />`
 * dialog inside the provider's render and consumes `open` / `close` /
 * `isOpen` to drive it.
 */

type SearchPaletteApi = {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const SearchPaletteCtx = createContext<SearchPaletteApi>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
})

export function SearchPaletteProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])
  return (
    <SearchPaletteCtx.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </SearchPaletteCtx.Provider>
  )
}

export function useSearchPalette(): SearchPaletteApi {
  return useContext(SearchPaletteCtx)
}
