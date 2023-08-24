import { genUUID } from './random'

interface Storage {
  getItem: (key: string) => any
  setItem: (key: string, value: string) => void
}

interface NavEntry {
  [key: string]: any
}

interface Options {
  key?: string
  navEntries?: NavEntry[]
  storage?: Storage
}

interface ReturnValue {
  tabId: string
  hasExisting: boolean
  usingExisting: boolean
  mayBeDuplicate?: boolean
}

// Default sessionStorage key to store the tab ID in.
const defaultKey = 'electric-sql.utils.tab:id'

// Used for in-memory storage when `sessionStorage` is not supported.
let tabId: string | null = null

// Returns a unique ID for each browser tab. This can be used to construct a
// tab scoped DB name. This allows data to sync between tabs by using one
// named SQLite database file per tab. This is sub-optimal compared with
// sharing a database but avoids concurrent database access.
//
// Handles duplicate tabs with some potential for false positives.
// False positives result in a new tabID which means a new database name
// and thus additional data transfer and storage.
//
// Uses window.sessionStorage. Some browsers disable access to sessionStorage
// even when saying its available (e.g.: as a result of disabling third party
// cookies o_O). So we handle this by falling back to an in-memory tabId 
// singleton -- which means each page load syncs data into a new DB.
//
// Other platforms can pass in a storage implementation or default to the
// in-memory tabId singleton.
export const uniqueTabId = (opts: Options = {}): ReturnValue => {
  const key = opts.key ?? defaultKey

  // Use sessionStorage as the default storage if available.
  let defaultStorage: Storage
  try {
    defaultStorage = window.sessionStorage
  } catch {
    // We catch errors in the Storage use (we have to to handle
    // browser security where they pretend Storage is available
    // but then throw errors when you use it) so this cast isn't
    // as bad as it looks.
    defaultStorage = {} as Storage
  }
  const storage: Storage = opts.storage ?? defaultStorage

  let defaultNavEntries: NavEntry[]
  try {
    defaultNavEntries = window.performance.getEntriesByType('navigation')
  } catch {
    defaultNavEntries = []
  }
  const navEntries = opts.navEntries ?? defaultNavEntries

  // Lookup the tabId
  let existingTabId: string | null
  let usedSessionStorage: boolean
  try {
    existingTabId = storage.getItem(key)
    usedSessionStorage = true
  } catch {
    existingTabId = tabId
    usedSessionStorage = false
  }
  const hasExisting = existingTabId !== null

  // If we got the tab ID from memory then always use it.
  if (hasExisting && !usedSessionStorage) {
    return {
      tabId: existingTabId as string,
      hasExisting: true,
      usingExisting: true,
    }
  }

  // If it's not a duplicate tab then use it.
  const navEntry =
    navEntries && navEntries.length ? navEntries[0] : { type: null }
  const mayBeDuplicate = navEntry.type === 'back_forward'

  if (hasExisting && !mayBeDuplicate) {
    return {
      tabId: existingTabId as string,
      hasExisting: true,
      usingExisting: true,
      mayBeDuplicate: false,
    }
  }

  // Otherwise generate, store and return a new one.
  const newTabId = genUUID()
  try {
    storage.setItem(key, newTabId)
  } catch {
    tabId = newTabId
  }

  return {
    tabId: newTabId,
    hasExisting: hasExisting,
    usingExisting: false,
    mayBeDuplicate: mayBeDuplicate,
  }
}
