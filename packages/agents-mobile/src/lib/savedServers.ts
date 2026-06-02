import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Persisted list of the agents servers the user has connected to —
 * the mobile counterpart of the desktop's `ServerConfig[]` in
 * `settings.json`. Mobile keeps the single *active* server URL in
 * `MobileAppState`; this store remembers every server so the unified
 * picker (`useAvailableServers` → `HomeMenu`'s server submenu) can list
 * them and the user can switch between them without re-entering URLs.
 *
 * Implemented as a tiny module-level store (no provider), mirroring
 * `sidebarPrefs.ts` — both React components (`useSavedServers`) and the
 * non-React sign-out cleanup in `MobileAppState` (`getSavedServers`)
 * subscribe to the same change stream.
 *
 * Cloud servers are stored with `source: 'electric-cloud'` so they can be
 * purged on sign-out. We deliberately store no token/tenantId: the agents
 * token is derived from the URL at request time by `prepareServerHeaders`.
 */

export type SavedServerSource = `manual` | `electric-cloud`

export type SavedServer = {
  /** For cloud servers, the `stream_services.id`; for manual servers, the URL. */
  id: string
  name: string
  url: string
  source: SavedServerSource
}

const STORAGE_KEY = `electric-agents-mobile.servers`

let current: ReadonlyArray<SavedServer> = []
const listeners = new Set<(servers: ReadonlyArray<SavedServer>) => void>()
let hydrated = false
// Set once a mutation happens so late-arriving hydration can't clobber a
// server the user added during the (brief) startup hydration window.
let dirty = false

void (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = (JSON.parse(raw) as Array<Partial<SavedServer>>)
        .filter(
          (s): s is SavedServer =>
            typeof s?.id === `string` &&
            typeof s?.name === `string` &&
            typeof s?.url === `string` &&
            (s?.source === `manual` || s?.source === `electric-cloud`)
        )
        .map((s) => ({ id: s.id, name: s.name, url: s.url, source: s.source }))
      if (dirty) {
        // A mutation landed before hydration finished (e.g. the active-server
        // migration in MobileAppState). Merge rather than clobber: keep the
        // persisted entries, then append the just-added ones (deduped by URL).
        const persistedUrls = new Set(parsed.map((s) => s.url))
        current = [
          ...parsed,
          ...current.filter((s) => !persistedUrls.has(s.url)),
        ]
        persist()
      } else {
        current = parsed
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

function update(next: ReadonlyArray<SavedServer>): void {
  current = next
  dirty = true
  persist()
  for (const listener of listeners) listener(current)
}

/** Synchronous snapshot for non-React callers (e.g. sign-out cleanup). */
export function getSavedServers(): ReadonlyArray<SavedServer> {
  return current
}

export function useSavedServers(): ReadonlyArray<SavedServer> {
  const [state, setState] = useState<ReadonlyArray<SavedServer>>(current)
  useEffect(() => {
    listeners.add(setState)
    if (hydrated) setState(current)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}

/**
 * Insert or update a saved server. Identity is the connection URL — a
 * re-connect to the same URL updates the existing entry (name/source)
 * rather than creating a duplicate.
 */
export function addSavedServer(server: SavedServer): void {
  const existingIndex = current.findIndex((s) => s.url === server.url)
  if (existingIndex === -1) {
    update([...current, server])
    return
  }
  const next = current.slice()
  next[existingIndex] = server
  update(next)
}

export function removeSavedServerById(id: string): void {
  const next = current.filter((s) => s.id !== id)
  if (next.length !== current.length) update(next)
}

/** Drop every cloud server — used when the user signs out of Electric Cloud. */
export function removeCloudSavedServers(): void {
  const next = current.filter((s) => s.source !== `electric-cloud`)
  if (next.length !== current.length) update(next)
}
