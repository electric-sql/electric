import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = `electric-agents-ui.recent-working-dirs`
const MAX_RECENTS = 10

/**
 * Most-recently-used absolute paths chosen by the user as a Horton
 * working directory. Persisted to `localStorage` so it survives reloads
 * and is shared across Electron windows (same origin, so localStorage
 * is shared).
 *
 * **Why localStorage rather than IPC + main-process settings?** The
 * recents list is purely UI sugar — it doesn't affect any backend
 * behaviour. Keeping it client-side means the same hook works in the
 * web build where there's no Electron main process, and we avoid an
 * IPC round-trip every time the picker opens.
 *
 * Recents are stored newest-first; calling `addRecent(path)` moves an
 * existing path to the front and trims the tail at `MAX_RECENTS`.
 */
function readInitial(): Array<string> {
  if (typeof window === `undefined`) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === `string`)
  } catch {
    return []
  }
}

function persist(list: Array<string>): void {
  if (typeof window === `undefined`) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Quota / private mode — silent. Recents are pure UI sugar.
  }
}

// Module-level state + listeners so the hook stays in sync across
// every mounted instance (e.g. NewSessionView and the sidebar
// group-by reading the same recents list don't drift).
let recents: Array<string> = readInitial()
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function useRecentWorkingDirectories(): {
  recents: ReadonlyArray<string>
  addRecent: (path: string) => void
  removeRecent: (path: string) => void
  clearRecents: () => void
} {
  const [snapshot, setSnapshot] = useState<ReadonlyArray<string>>(recents)
  useEffect(() => {
    const listener = (): void => setSnapshot(recents)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const addRecent = useCallback((path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    recents = [trimmed, ...recents.filter((p) => p !== trimmed)].slice(
      0,
      MAX_RECENTS
    )
    persist(recents)
    notify()
  }, [])

  const removeRecent = useCallback((path: string) => {
    recents = recents.filter((p) => p !== path)
    persist(recents)
    notify()
  }, [])

  const clearRecents = useCallback(() => {
    recents = []
    persist(recents)
    notify()
  }, [])

  return { recents: snapshot, addRecent, removeRecent, clearRecents }
}
