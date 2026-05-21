import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Mobile mirror of the web `useSidebarView` store. Persisted to
 * AsyncStorage under a single JSON key so the user's group-by and
 * hidden-set choices survive a relaunch.
 *
 * Implemented as a tiny module-level store (no provider) — the
 * SessionListScreen and the BottomSheet menu both subscribe to the
 * same change stream so menu toggles update the list immediately.
 */

export type SidebarGroupBy = `date` | `type` | `status`

export const SIDEBAR_GROUP_BY_OPTIONS: ReadonlyArray<SidebarGroupBy> = [
  `date`,
  `type`,
  `status`,
]

export const SIDEBAR_GROUP_BY_LABELS: Record<SidebarGroupBy, string> = {
  date: `Date`,
  type: `Type`,
  status: `Status`,
}

export type SidebarPrefs = {
  groupBy: SidebarGroupBy
  hiddenTypes: ReadonlySet<string>
  hiddenStatuses: ReadonlySet<string>
}

const DEFAULT_PREFS: SidebarPrefs = {
  groupBy: `date`,
  hiddenTypes: new Set<string>(),
  hiddenStatuses: new Set<string>(),
}

const STORAGE_KEY = `electric-agents-mobile.sidebar-prefs`

let current: SidebarPrefs = DEFAULT_PREFS
const listeners = new Set<(prefs: SidebarPrefs) => void>()
let hydrated = false

void (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as {
        groupBy?: SidebarGroupBy
        hiddenTypes?: Array<string>
        hiddenStatuses?: Array<string>
      }
      current = {
        groupBy: parsed.groupBy ?? DEFAULT_PREFS.groupBy,
        hiddenTypes: new Set(parsed.hiddenTypes ?? []),
        hiddenStatuses: new Set(parsed.hiddenStatuses ?? []),
      }
    }
  } catch {
    // Ignore hydration errors — fall back to defaults.
  } finally {
    hydrated = true
    for (const listener of listeners) listener(current)
  }
})()

function persist(): void {
  void AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      groupBy: current.groupBy,
      hiddenTypes: Array.from(current.hiddenTypes),
      hiddenStatuses: Array.from(current.hiddenStatuses),
    })
  ).catch(() => {})
}

function update(next: SidebarPrefs): void {
  current = next
  persist()
  for (const listener of listeners) listener(current)
}

export function useSidebarPrefs(): SidebarPrefs {
  const [state, setState] = useState<SidebarPrefs>(current)
  useEffect(() => {
    listeners.add(setState)
    if (hydrated) setState(current)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}

export function setSidebarGroupBy(groupBy: SidebarGroupBy): void {
  update({ ...current, groupBy })
}

export function toggleSidebarTypeVisibility(type: string): void {
  const next = new Set(current.hiddenTypes)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  update({ ...current, hiddenTypes: next })
}

export function toggleSidebarStatusVisibility(status: string): void {
  const next = new Set(current.hiddenStatuses)
  if (next.has(status)) next.delete(status)
  else next.add(status)
  update({ ...current, hiddenStatuses: next })
}

export function resetSidebarFilters(): void {
  update({
    ...current,
    hiddenTypes: new Set<string>(),
    hiddenStatuses: new Set<string>(),
  })
}
