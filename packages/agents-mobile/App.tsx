import { useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AgentsProvider } from './src/lib/AgentsProvider'
import {
  ThemeProvider,
  useColorSchemeMode,
  useTokens,
} from './src/lib/ThemeProvider'
import { DiagnosticsScreen } from './src/screens/DiagnosticsScreen'
import { NewSessionScreen } from './src/screens/NewSessionScreen'
import { ServerSetupScreen } from './src/screens/ServerSetupScreen'
import { SessionListScreen } from './src/screens/SessionListScreen'
import { SessionScreen } from './src/screens/SessionScreen'
import { PersistentEmbed } from './src/webview/PersistentEmbed'
import type { EmbedViewId } from './src/webview/embedSource'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`

/**
 * Pixel height of the `<Header>` strip — kept in lockstep with
 * `rowHeight.xl` (44px) so we can position the persistent WebView
 * directly below it without measuring at runtime. If you change the
 * header height in `Header.tsx`, change this constant too.
 */
const HEADER_HEIGHT = 44

type Route =
  | { name: `sessions` }
  | { name: `new-session` }
  | { name: `session`; entityUrl: string; view: EmbedViewId }
  | { name: `diagnostics` }
  | { name: `server-setup` }

/**
 * Subset of routes handled by `<RoutedShell>` — `server-setup` is
 * intercepted before we get there so the persistent embed never has
 * to worry about a missing serverUrl.
 */
type ShellRoute = Exclude<Route, { name: `server-setup` }>

export default function App(): React.ReactElement {
  return (
    // SafeAreaProvider is required for `react-native-safe-area-context`
    // hooks/components to read insets on iOS notches and Android
    // edge-to-edge mode (set via `android.edgeToEdgeEnabled` in
    // `app.json`).
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

function AppShell(): React.ReactElement {
  const tokens = useTokens()
  const scheme = useColorSchemeMode()

  const [loading, setLoading] = useState(true)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>({ name: `sessions` })

  useEffect(() => {
    AsyncStorage.getItem(SERVER_URL_KEY)
      .then((stored) => {
        setServerUrl(stored)
        if (!stored) setRoute({ name: `server-setup` })
      })
      .finally(() => setLoading(false))
  }, [])

  const saveServerUrl = async (next: string) => {
    await AsyncStorage.setItem(SERVER_URL_KEY, next)
    setServerUrl(next)
    setRoute({ name: `sessions` })
  }

  const openSession = (entityUrl: string, view: EmbedViewId = `chat`) => {
    setRoute({ name: `session`, entityUrl, view })
  }

  // `expo-status-bar` flips text colour automatically and plays nicely
  // with Android `edgeToEdgeEnabled` (translucent system bar). The
  // explicit style still wins on iOS so the bar stays legible against
  // the resolved theme background.
  const statusBarStyle = scheme === `dark` ? `light` : `dark`

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: tokens.bg }]}>
        <StatusBar style={statusBarStyle} />
        <ActivityIndicator color={tokens.accent11} />
      </View>
    )
  }

  if (!serverUrl || route.name === `server-setup`) {
    return (
      <>
        <StatusBar style={statusBarStyle} />
        <ServerSetupScreen
          initialUrl={serverUrl ?? undefined}
          onCancel={
            serverUrl ? () => setRoute({ name: `sessions` }) : undefined
          }
          onSave={saveServerUrl}
        />
      </>
    )
  }

  // After the early-return above, `route.name` is guaranteed to be
  // `sessions | new-session | session`. Narrow the prop type so
  // `<RoutedShell>` doesn't have to re-check for `server-setup`.
  const shellRoute = route as ShellRoute

  return (
    <AgentsProvider serverUrl={serverUrl}>
      <StatusBar style={statusBarStyle} />
      <RoutedShell
        route={shellRoute}
        onOpenSession={openSession}
        onNewSession={() => setRoute({ name: `new-session` })}
        onChangeServer={() => setRoute({ name: `server-setup` })}
        onOpenDiagnostics={() => setRoute({ name: `diagnostics` })}
        onBackToSessions={() => setRoute({ name: `sessions` })}
        onSetView={(view) => {
          if (route.name === `session`) {
            setRoute({ ...route, view })
          }
        }}
      />
    </AgentsProvider>
  )
}

/**
 * Two-layer screen renderer:
 *
 *   1. The currently routed native screen.
 *   2. A single, app-level `<PersistentEmbed>` WebView that survives
 *      navigation. Hidden via `display: 'none'` on non-session routes,
 *      revealed and `set-entity` / `set-view` posted on session routes.
 *
 * The bundle therefore parses **once** per app launch — every later
 * open of a session is just a postMessage round-trip away. The native
 * shell still owns the chrome (header, back button, view toggle).
 */
function RoutedShell({
  route,
  onOpenSession,
  onNewSession,
  onChangeServer,
  onOpenDiagnostics,
  onBackToSessions,
  onSetView,
}: {
  route: ShellRoute
  onOpenSession: (entityUrl: string) => void
  onNewSession: () => void
  onChangeServer: () => void
  onOpenDiagnostics: () => void
  onBackToSessions: () => void
  onSetView: (view: EmbedViewId) => void
}): React.ReactElement {
  const insets = useSafeAreaInsets()
  // The persistent WebView slots into the body of `SessionScreen`,
  // i.e. directly under the safe-area top inset and the 44px
  // `<Header>` strip.
  const embedTop = insets.top + HEADER_HEIGHT
  const active = useMemo(
    () =>
      route.name === `session`
        ? { entityUrl: route.entityUrl, view: route.view }
        : null,
    [route]
  )

  return (
    <View style={styles.shell}>
      {route.name === `sessions` ? (
        <SessionListScreen
          onOpenSession={(entityUrl) => onOpenSession(entityUrl)}
          onNewSession={onNewSession}
          onChangeServer={onChangeServer}
          onOpenDiagnostics={onOpenDiagnostics}
        />
      ) : route.name === `new-session` ? (
        <NewSessionScreen
          onBack={onBackToSessions}
          onOpenSession={(entityUrl) => onOpenSession(entityUrl)}
        />
      ) : route.name === `diagnostics` ? (
        <DiagnosticsScreen onBack={onBackToSessions} />
      ) : (
        <SessionScreen
          entityUrl={route.entityUrl}
          view={route.view}
          onBack={onBackToSessions}
          onSetView={onSetView}
        />
      )}

      <PersistentEmbed
        active={active}
        containerStyle={{ top: embedTop }}
        onNavigateToEntity={(target) => onOpenSession(target)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: `center`,
    justifyContent: `center`,
  },
})
