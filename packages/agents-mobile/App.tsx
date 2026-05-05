import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AgentsProvider } from './src/lib/AgentsProvider'
import {
  ThemeProvider,
  useColorSchemeMode,
  useTokens,
} from './src/lib/ThemeProvider'
import { NewSessionScreen } from './src/screens/NewSessionScreen'
import { ServerSetupScreen } from './src/screens/ServerSetupScreen'
import { SessionListScreen } from './src/screens/SessionListScreen'
import { SessionScreen } from './src/screens/SessionScreen'
import type { EmbedViewId } from './src/webview/embedSource'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`

type Route =
  | { name: `sessions` }
  | { name: `new-session` }
  | { name: `session`; entityUrl: string; view: EmbedViewId }
  | { name: `server-setup` }

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

  return (
    <AgentsProvider serverUrl={serverUrl}>
      <StatusBar style={statusBarStyle} />
      {route.name === `sessions` ? (
        <SessionListScreen
          onOpenSession={(entityUrl) => openSession(entityUrl)}
          onNewSession={() => setRoute({ name: `new-session` })}
          onChangeServer={() => setRoute({ name: `server-setup` })}
        />
      ) : route.name === `new-session` ? (
        <NewSessionScreen
          onBack={() => setRoute({ name: `sessions` })}
          onOpenSession={(entityUrl) => openSession(entityUrl)}
        />
      ) : (
        <SessionScreen
          entityUrl={route.entityUrl}
          initialView={route.view}
          onBack={() => setRoute({ name: `sessions` })}
          onOpenEntity={(target) => openSession(target)}
        />
      )}
    </AgentsProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: `center`,
    justifyContent: `center`,
  },
})
