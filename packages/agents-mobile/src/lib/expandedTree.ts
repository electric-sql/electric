import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Per-row tree expansion state for the mobile session list, persisted
 * across launches. Mobile mirror of
 * `agents-server-ui/src/hooks/useExpandedTreeNodes.ts`.
 *
 * **Why an external store (vs `useState`)?** Expansion state is read
 * by every visible row but only *changes* for one row at a time. A
 * single React state owning the whole `Set<string>` would re-render
 * the whole tree on every toggle. Per-url listener buckets keep the
 * fan-out tight: toggling row A only re-renders A.
 *
 * Children are collapsed by default — a row only expands when the
 * user taps its caret.
 */

type Listener = () => void

const STORAGE_KEY = `electric-agents-mobile.tree.expanded`

let expanded: Set<string> = new Set()
let hydrated = false
const listeners = new Map<string, Set<Listener>>()
const allListeners = new Set<Listener>()

function notify(url: string): void {
  const bucket = listeners.get(url)
  if (bucket) {
    for (const l of bucket) l()
  }
  for (const l of allListeners) l()
}

function persist(): void {
  void AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(Array.from(expanded))
  ).catch(() => {})
}

void (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        expanded = new Set(
          parsed.filter((v): v is string => typeof v === `string`)
        )
      }
    }
  } catch {
    // Ignore hydration errors — defaults are fine.
  } finally {
    hydrated = true
    // Fan out to every subscriber so any row that mounted before
    // hydration redraws against the persisted set.
    for (const bucket of listeners.values()) {
      for (const l of bucket) l()
    }
    for (const l of allListeners) l()
  }
})()

export function isExpanded(url: string): boolean {
  return expanded.has(url)
}

export function toggleExpanded(url: string): void {
  if (expanded.has(url)) expanded.delete(url)
  else expanded.add(url)
  persist()
  notify(url)
}

export function collapseAllExpanded(): void {
  if (expanded.size === 0) return
  const wasExpanded = Array.from(expanded)
  expanded = new Set()
  persist()
  for (const url of wasExpanded) notify(url)
}

export function expandAllUrls(urls: ReadonlyArray<string>): void {
  let changed = false
  for (const url of urls) {
    if (!expanded.has(url)) {
      expanded.add(url)
      notify(url)
      changed = true
    }
  }
  if (changed) persist()
}

/**
 * Subscribe a single row to its own expansion state. Re-renders the
 * caller only when *this URL's* expansion flips.
 */
export function useIsExpanded(url: string): boolean {
  const [state, setState] = useState<boolean>(() => expanded.has(url))
  useEffect(() => {
    const listener = (): void => setState(expanded.has(url))
    let bucket = listeners.get(url)
    if (!bucket) {
      bucket = new Set()
      listeners.set(url, bucket)
    }
    bucket.add(listener)
    if (hydrated) listener()
    return () => {
      const b = listeners.get(url)
      if (!b) return
      b.delete(listener)
      if (b.size === 0) listeners.delete(url)
    }
  }, [url])
  return state
}
