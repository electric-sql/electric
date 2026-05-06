import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type PaneFindContextValue = {
  activeTileId: string | null
  openForTile: (tileId: string) => void
  close: () => void
  getAdapter: (tileId: string) => PaneFindAdapter | null
}

const PaneFindContext = createContext<PaneFindContextValue | null>(null)

export function PaneFindProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [activeTileId, setActiveTileId] = useState<string | null>(null)

  const getAdapter = useCallback(
    (tileId: string) => adapterRegistry.get(tileId) ?? null,
    []
  )

  const value = useMemo<PaneFindContextValue>(
    () => ({
      activeTileId,
      openForTile: setActiveTileId,
      close: () => setActiveTileId(null),
      getAdapter,
    }),
    [activeTileId, getAdapter]
  )

  return (
    <PaneFindContext.Provider value={value}>
      {children}
    </PaneFindContext.Provider>
  )
}

export function usePaneFind(): PaneFindContextValue {
  const value = useContext(PaneFindContext)
  if (!value)
    throw new Error(`usePaneFind must be used inside PaneFindProvider`)
  return value
}

export type PaneFindApi = {
  open: () => void
  next: () => void
  previous: () => void
}

export type PaneFindMatch = {
  id: string
  label?: string
  excerpt?: string
  rowOccurrence?: number
}

export type PaneFindAdapter = {
  search: (query: string) => Array<PaneFindMatch>
  reveal: (match: PaneFindMatch) => void | Promise<void>
  getHighlightRoot: (match: PaneFindMatch) => HTMLElement | null
  getCurrentMatchIndex?: (match: PaneFindMatch, query: string) => number
}

const registry = new Map<string, PaneFindApi>()
const adapterRegistry = new Map<string, PaneFindAdapter>()

export function usePaneFindRegistration(
  tileId: string,
  api: PaneFindApi | null
): void {
  const apiRef = useRef(api)
  apiRef.current = api

  // Register a stable proxy once per tile id so callers always hit the
  // latest callbacks without re-registering on every render.
  useEffect(() => {
    if (!apiRef.current) {
      registry.delete(tileId)
      return
    }
    const proxy: PaneFindApi = {
      open: () => apiRef.current?.open(),
      next: () => apiRef.current?.next(),
      previous: () => apiRef.current?.previous(),
    }
    registry.set(tileId, proxy)
    return () => {
      if (registry.get(tileId) === proxy) registry.delete(tileId)
    }
  }, [tileId])
}

export function unregisterPaneFind(tileId: string): void {
  registry.delete(tileId)
}

export function usePaneFindAdapterRegistration(
  tileId: string | null,
  adapter: PaneFindAdapter | null
): void {
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  useEffect(() => {
    if (!tileId) return
    if (!adapterRef.current) {
      adapterRegistry.delete(tileId)
      return
    }
    const proxy: PaneFindAdapter = {
      search: (query) => adapterRef.current?.search(query) ?? [],
      reveal: (match) => adapterRef.current?.reveal(match),
      getHighlightRoot: (match) =>
        adapterRef.current?.getHighlightRoot(match) ?? null,
      getCurrentMatchIndex: (match, query) =>
        adapterRef.current?.getCurrentMatchIndex?.(match, query) ?? 0,
    }
    adapterRegistry.set(tileId, proxy)
    return () => {
      if (adapterRegistry.get(tileId) === proxy) adapterRegistry.delete(tileId)
    }
  }, [tileId])
}

export function usePaneFindCommands(): {
  openFindForTile: (tileId: string | null) => void
  findNextInTile: (tileId: string | null) => void
  findPreviousInTile: (tileId: string | null) => void
} {
  const { openForTile } = usePaneFind()
  return {
    openFindForTile: useCallback(
      (tileId) => {
        if (!tileId) return
        const api = registry.get(tileId)
        if (!api) return
        openForTile(tileId)
        api.open()
      },
      [openForTile]
    ),
    findNextInTile: useCallback((tileId) => {
      if (!tileId) return
      registry.get(tileId)?.next()
    }, []),
    findPreviousInTile: useCallback((tileId) => {
      if (!tileId) return
      registry.get(tileId)?.previous()
    }, []),
  }
}
