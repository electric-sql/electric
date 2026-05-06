import { useSyncExternalStore } from 'react'

const STORAGE_KEY = `electric-agents-ui.sidebar.view`

/** Available grouping modes for the session list. */
export type SidebarGroupBy = `date` | `type` | `status` | `workingDir`

export const SIDEBAR_GROUP_BY_OPTIONS: ReadonlyArray<SidebarGroupBy> = [
  `date`,
  `type`,
  `status`,
  `workingDir`,
]

export const SIDEBAR_GROUP_BY_LABELS: Record<SidebarGroupBy, string> = {
  date: `Date`,
  type: `Type`,
  status: `Status`,
  workingDir: `Working dir`,
}

interface SidebarViewState {
  groupBy: SidebarGroupBy
  /** Entity types to *hide*. Stored as an exclusion set so newly seen
   *  types default to visible without an explicit allow-list update. */
  hiddenTypes: Set<string>
  /** Statuses to hide. Same exclusion-set convention as hiddenTypes. */
  hiddenStatuses: Set<string>
}

const DEFAULT_STATE: SidebarViewState = {
  groupBy: `date`,
  hiddenTypes: new Set(),
  hiddenStatuses: new Set(),
}

/**
 * View preferences for the sidebar — drives the `<SidebarViewMenu>`
 * dropdown next to the settings cog.
 *
 * **Why an external store (vs `useState` + context)?**
 * The pattern matches `useExpandedTreeNodes`: the SidebarViewMenu
 * (which renders inside a popup portal) and the Sidebar (which lives
 * up the tree) both need to read and write this state without
 * forcing a context provider near the top of the app. A module-level
 * store + `useSyncExternalStore` lets each subscribe individually
 * and only re-render when their slice changes.
 *
 * **Hidden vs visible** — both `hiddenTypes` and `hiddenStatuses` are
 * stored as *exclusion* sets. Anything not in the set is shown. This
 * means a freshly-seen entity type (e.g. a new agent kind shipped in
 * a server update) is visible by default rather than silently filtered
 * out because it wasn't in an old allow-list.
 */
type Listener = () => void

class SidebarViewStore {
  private state: SidebarViewState = readInitial()
  private listeners: Set<Listener> = new Set()

  getState = (): SidebarViewState => this.state

  setGroupBy = (groupBy: SidebarGroupBy): void => {
    if (this.state.groupBy === groupBy) return
    this.state = { ...this.state, groupBy }
    this.persist()
    this.notify()
  }

  toggleTypeVisibility = (type: string): void => {
    const next = new Set(this.state.hiddenTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    this.state = { ...this.state, hiddenTypes: next }
    this.persist()
    this.notify()
  }

  toggleStatusVisibility = (status: string): void => {
    const next = new Set(this.state.hiddenStatuses)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    this.state = { ...this.state, hiddenStatuses: next }
    this.persist()
    this.notify()
  }

  resetVisibility = (): void => {
    this.state = {
      ...this.state,
      hiddenTypes: new Set(),
      hiddenStatuses: new Set(),
    }
    this.persist()
    this.notify()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  private persist(): void {
    if (typeof window === `undefined`) return
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          groupBy: this.state.groupBy,
          hiddenTypes: Array.from(this.state.hiddenTypes),
          hiddenStatuses: Array.from(this.state.hiddenStatuses),
        })
      )
    } catch {
      // Quota / private mode — silent. View prefs not making it to
      // disk is recoverable on next session.
    }
  }
}

function readInitial(): SidebarViewState {
  if (typeof window === `undefined`) return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<{
      groupBy: SidebarGroupBy
      hiddenTypes: Array<string>
      hiddenStatuses: Array<string>
    }>
    return {
      groupBy: SIDEBAR_GROUP_BY_OPTIONS.includes(
        parsed.groupBy as SidebarGroupBy
      )
        ? (parsed.groupBy as SidebarGroupBy)
        : DEFAULT_STATE.groupBy,
      hiddenTypes: new Set(
        Array.isArray(parsed.hiddenTypes) ? parsed.hiddenTypes : []
      ),
      hiddenStatuses: new Set(
        Array.isArray(parsed.hiddenStatuses) ? parsed.hiddenStatuses : []
      ),
    }
  } catch {
    return DEFAULT_STATE
  }
}

const store = new SidebarViewStore()

/** Read the full sidebar-view state (re-renders whenever any slice changes). */
export function useSidebarView(): SidebarViewState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

export const setSidebarGroupBy = store.setGroupBy
export const toggleSidebarTypeVisibility = store.toggleTypeVisibility
export const toggleSidebarStatusVisibility = store.toggleStatusVisibility
export const resetSidebarVisibility = store.resetVisibility
