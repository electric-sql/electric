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
import { CloudAuthProvider } from '../src/lib/CloudAuthContext'
import { isCallbackUrl } from '../src/lib/cloudAuth'

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <MobileAppStateProvider>
            <CloudAuthProvider>
              <RootNavigator />
            </CloudAuthProvider>
          </MobileAppStateProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function RootNavigator(): React.ReactElement {
  const { loading, serverUrl, launchUrl, onboardingDismissed } =
    useMobileAppState()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const pathname = usePathname()
  const statusBarStyle = scheme === `dark` ? `light` : `dark`
  const coldStartOAuthCallback =
    !!launchUrl && isCallbackUrl(launchUrl) && pathname !== `/oauth/callback`

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: tokens.bg }]}>
        <StatusBar style={statusBarStyle} />
        <ActivityIndicator color={tokens.accent11} />
      </View>
    )
  }

  if (coldStartOAuthCallback) {
    return <Redirect href="/oauth/callback" />
  }

  // First-launch onboarding takes precedence over the server-setup
  // redirect — the wizard subsumes the URL input as its step 2, and
  // dismissing it falls back to `/server-setup` only if the user
  // still hasn't configured a server.
  if (
    !onboardingDismissed &&
    pathname !== `/onboarding` &&
    pathname !== `/oauth/callback`
  ) {
    return <Redirect href="/onboarding" />
  }

  if (
    !serverUrl &&
    pathname !== `/server-setup` &&
    pathname !== `/onboarding` &&
    pathname !== `/oauth/callback`
  ) {
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
