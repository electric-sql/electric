import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Pinned session URLs for the home-screen list, persisted across
 * launches. Mobile mirror of the desktop's `usePinnedEntities`
 * (array-of-urls in `localStorage`) — per-device UI state, never
 * synced to the server. Tiny module-level store (no provider),
 * mirroring `sidebarPrefs.ts` / `savedServers.ts`.
 */

const STORAGE_KEY = `electric-agents-mobile.pinned-entities`

let current: ReadonlyArray<string> = []
const listeners = new Set<(urls: ReadonlyArray<string>) => void>()
let hydrated = false
// Set once a mutation happens so late-arriving hydration can't clobber a
// pin the user toggled during the (brief) startup hydration window.
let dirty = false

void (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      const persisted = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === `string`)
        : []
      if (dirty) {
        // Toggle landed pre-hydration: merge persisted + just-added
        // (deduped by url) rather than clobber.
        const persistedSet = new Set(persisted)
        current = [
          ...persisted,
          ...current.filter((url) => !persistedSet.has(url)),
        ]
        persist()
      } else {
        current = persisted
      }
    }
  } catch {
    // Ignore hydration errors — fall back to an empty list.
  } finally {
    hydrated = true
    for (const listener of listeners) listener(current)
  }
})()

function persist(): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current)).catch(
    () => {}
  )
}

function update(next: ReadonlyArray<string>): void {
  current = next
  dirty = true
  persist()
  for (const listener of listeners) listener(current)
}

/** Synchronous snapshot for non-React callers (and tests). */
export function getPinnedUrls(): ReadonlyArray<string> {
  return current
}

export function togglePin(url: string): void {
  if (current.includes(url)) {
    update(current.filter((u) => u !== url))
  } else {
    update([...current, url])
  }
}

export function usePinnedUrls(): ReadonlyArray<string> {
  const [state, setState] = useState<ReadonlyArray<string>>(current)
  useEffect(() => {
    listeners.add(setState)
    if (hydrated) setState(current)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}
