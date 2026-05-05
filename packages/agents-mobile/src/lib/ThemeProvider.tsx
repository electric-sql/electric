import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { darkTokens, lightTokens, type ColorScheme, type Tokens } from './theme'
import { useThemePreference } from './themePref'

type ThemeContextValue = {
  scheme: ColorScheme
  tokens: Tokens
}

const ThemeContext = createContext<ThemeContextValue>({
  scheme: `dark`,
  tokens: darkTokens,
})

/**
 * Wraps the app with the resolved color-scheme tokens.
 *
 * Mirrors how `agents-server-ui`'s `ThemeProvider` flips
 * `data-theme="dark|light"` so the same token names produce per-mode
 * values without screens having to branch on scheme. The user's
 * persisted theme preference (`system` / `light` / `dark`) takes
 * precedence over the OS scheme when set.
 */
export function ThemeProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const systemScheme = useColorScheme() ?? `dark`
  const preference = useThemePreference()
  const value = useMemo<ThemeContextValue>(() => {
    const resolved: ColorScheme =
      preference === `system`
        ? systemScheme === `light`
          ? `light`
          : `dark`
        : preference
    return {
      scheme: resolved,
      tokens: resolved === `dark` ? darkTokens : lightTokens,
    }
  }, [systemScheme, preference])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTokens(): Tokens {
  return useContext(ThemeContext).tokens
}

export function useColorSchemeMode(): ColorScheme {
  return useContext(ThemeContext).scheme
}
