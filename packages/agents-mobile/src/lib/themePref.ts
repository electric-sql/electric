import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * User-facing theme preference. Mirrors the web `useDarkMode` store —
 * `system` defers to the OS, `light` / `dark` force a fixed scheme.
 *
 * The active scheme (light vs dark) is resolved by `ThemeProvider`,
 * which combines this preference with `useColorScheme()`.
 */

export type ThemePreference = `system` | `light` | `dark`

export const THEME_PREFERENCE_OPTIONS: ReadonlyArray<ThemePreference> = [
  `system`,
  `light`,
  `dark`,
]

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: `System`,
  light: `Light`,
  dark: `Dark`,
}

const STORAGE_KEY = `electric-agents-mobile.theme-preference`

let current: ThemePreference = `system`
let hydrated = false
const listeners = new Set<(pref: ThemePreference) => void>()

void (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw === `light` || raw === `dark` || raw === `system`) {
      current = raw
    }
  } catch {
    // Ignore.
  } finally {
    hydrated = true
    for (const listener of listeners) listener(current)
  }
})()

export function useThemePreference(): ThemePreference {
  const [state, setState] = useState<ThemePreference>(current)
  useEffect(() => {
    listeners.add(setState)
    if (hydrated) setState(current)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}

export function setThemePreference(next: ThemePreference): void {
  current = next
  void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {})
  for (const listener of listeners) listener(current)
}
