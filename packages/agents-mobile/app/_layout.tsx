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
import { Sentry, initSentry } from '../src/lib/sentry'

// Initialize early so startup crashes are captured (no-op in dev).
initSentry()

function RootLayout(): React.ReactElement {
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

export default Sentry.wrap(RootLayout)

function RootNavigator(): React.ReactElement {
  const {
    loading,
    serverUrl,
    launchUrl,
    onboardingDismissed,
    pendingSessionLink,
  } = useMobileAppState()
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
  // redirect — the wizard subsumes the URL input as its step 2 and
  // runs until `onComplete` saves a URL. After that `/server-setup`
  // is only reachable via menu navigation.
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

  // Onboarding is done and a server is configured here. A pending open-session
  // deep link (cold-start seeded, or arrived mid-onboarding) is routed to its
  // landing route, which switches server if needed and opens the session. The
  // landing route clears the pending link, so this doesn't loop; `/session` is
  // excluded so navigating to the opened session doesn't bounce back.
  if (
    pendingSessionLink &&
    pathname !== `/open-session` &&
    pathname !== `/session`
  ) {
    return <Redirect href="/open-session" />
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
