import { useSyncExternalStore } from 'react'

const STORAGE_KEY = `electric-agents-ui.tree.expanded`

function readInitial(): Set<string> {
  if (typeof window === `undefined`) return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === `string`))
  } catch {
    return new Set()
  }
}

/**
 * Per-row tree expansion state for the sidebar, persisted across reloads.
 *
 * **Why an external store (vs `useState`)?**
 * Expansion state is read by every visible row in the tree but only
 * *changes* for one row at a time. With a single React state owning
 * the whole `Set<string>`, a toggle re-renders the owning component
 * (the Sidebar) and its entire row tree — even though only one row's
 * boolean actually flipped. With this store, each row subscribes to
 * just *its own* URL via `useSyncExternalStore`; a toggle on row A
 * notifies only A's listeners, leaving the rest of the sidebar
 * untouched.
 *
 * Children are collapsed by default — a row only expands when the
 * user clicks its caret (`toggleExpanded`).
 */
type Listener = () => void

class ExpandedTreeNodesStore {
  private expanded: Set<string> = readInitial()
  // Per-url listener buckets so a toggle on one row doesn't fan out
  // to every subscribed component in the tree. `Set` for O(1) add /
  // delete; never iterated other than for notification.
  private listeners: Map<string, Set<Listener>> = new Map()

  isExpanded = (url: string): boolean => this.expanded.has(url)

  toggle = (url: string): void => {
    if (this.expanded.has(url)) this.expanded.delete(url)
    else this.expanded.add(url)
    this.persist()
    this.notify(url)
  }

  /**
   * Collapse every currently-expanded row in one shot. Notifies each
   * affected URL's listeners individually so only the rows that were
   * actually expanded re-render.
   */
  collapseAll = (): void => {
    if (this.expanded.size === 0) return
    const wasExpanded = Array.from(this.expanded)
    this.expanded.clear()
    this.persist()
    for (const url of wasExpanded) this.notify(url)
  }

  /**
   * Expand every URL provided. Useful for the "Expand all" affordance
   * — caller passes the set of expandable nodes (e.g. tree roots
   * with children) so we don't need to know about the entity tree
   * here.
   */
  expandAll = (urls: ReadonlyArray<string>): void => {
    let changed = false
    for (const url of urls) {
      if (!this.expanded.has(url)) {
        this.expanded.add(url)
        this.notify(url)
        changed = true
      }
    }
    if (changed) this.persist()
  }

  subscribe = (url: string, listener: Listener): (() => void) => {
    let bucket = this.listeners.get(url)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(url, bucket)
    }
    bucket.add(listener)
    return () => {
      const b = this.listeners.get(url)
      if (!b) return
      b.delete(listener)
      if (b.size === 0) this.listeners.delete(url)
    }
  }

  private notify(url: string): void {
    const bucket = this.listeners.get(url)
    if (!bucket) return
    for (const l of bucket) l()
  }

  private persist(): void {
    if (typeof window === `undefined`) return
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(this.expanded))
      )
    } catch {
      // Quota exceeded / private mode etc. — silent. Expansion state
      // not making it to disk is recoverable; throwing here would
      // tear down the toggle handler instead.
    }
  }
}

const store = new ExpandedTreeNodesStore()

/**
 * Subscribe a single row to its own expansion state. Re-renders the
 * caller only when *this URL's* expansion flips.
 */
export function useIsExpanded(url: string): boolean {
  return useSyncExternalStore(
    (cb) => store.subscribe(url, cb),
    () => store.isExpanded(url),
    () => store.isExpanded(url)
  )
}

/**
 * Stable, module-scoped toggle. Safe to pass directly to JSX
 * handlers without `useCallback` — its identity never changes.
 */
export function toggleExpanded(url: string): void {
  store.toggle(url)
}

/** Collapse every expanded row. Bound to the SidebarViewMenu action. */
export function collapseAllExpanded(): void {
  store.collapseAll()
}

/** Expand the supplied list of URLs (no-op for already-expanded). */
export function expandAllUrls(urls: ReadonlyArray<string>): void {
  store.expandAll(urls)
}

/**
 * Synchronous read for non-component code paths (e.g. selection
 * effects in the entity router). Components should use
 * `useIsExpanded` instead so they re-render when the value flips.
 */
export function getIsExpanded(url: string): boolean {
  return store.isExpanded(url)
}
