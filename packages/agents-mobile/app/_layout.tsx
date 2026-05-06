import { Redirect, Stack, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context'
import { AgentsProvider } from '../src/lib/AgentsProvider'
import {
  ThemeProvider,
  useColorSchemeMode,
  useTokens,
} from '../src/lib/ThemeProvider'
import {
  MobileAppStateProvider,
  useMobileAppState,
} from '../src/lib/MobileAppState'

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <MobileAppStateProvider>
            <RootNavigator />
          </MobileAppStateProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function RootNavigator(): React.ReactElement {
  const { loading, serverUrl } = useMobileAppState()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const pathname = usePathname()
  const statusBarStyle = scheme === `dark` ? `light` : `dark`

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: tokens.bg }]}>
        <StatusBar style={statusBarStyle} />
        <ActivityIndicator color={tokens.accent11} />
      </View>
    )
  }

  if (!serverUrl && pathname !== `/server-setup`) {
    return <Redirect href="/server-setup" />
  }

  const stack = (
    <>
      <StatusBar style={statusBarStyle} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.bg },
          animation: `default`,
          gestureEnabled: true,
        }}
      />
    </>
  )

  return serverUrl ? (
    <AgentsProvider serverUrl={serverUrl}>{stack}</AgentsProvider>
  ) : (
    stack
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: `center`,
    justifyContent: `center`,
  },
})
