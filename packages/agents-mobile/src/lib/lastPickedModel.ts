import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Remembers the model the user last picked for a new session, mirroring the
 * desktop composer's localStorage behaviour (`NewSessionView`).
 *
 * AsyncStorage is async, so — like `themePref` — we hydrate a module-level
 * cache once at import (app start). The new-session screen mounts well after
 * that, so the cached value is available synchronously when deriving the
 * initial spawn args, avoiding a default-then-correct flash.
 */
const STORAGE_KEY = `electric-agents-mobile.new-session.last-picked-model`

let cached: string | null = null

void (async () => {
  try {
    cached = await AsyncStorage.getItem(STORAGE_KEY)
  } catch {
    // Ignore — fall back to the schema default.
  }
})()

/** The last-picked model if it's known and still offered by `options`. */
export function getLastPickedModel(
  options: ReadonlyArray<string>
): string | null {
  if (cached === null) return null
  return options.includes(cached) ? cached : null
}

export function persistLastPickedModel(value: string): void {
  cached = value
  void AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {
    // Best-effort — a failed write just forgets the preference.
  })
}
