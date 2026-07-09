import { Redirect, Stack, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context'
import { AgentsProvider } from '../src/lib/AgentsProvider'
import { PrimaryButton } from '../src/components/PrimaryButton'
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
import { fontSize, lineHeight, spacing } from '../src/lib/theme'
import { Sentry, initSentry } from '../src/lib/sentry'

// Initialize early so startup crashes are captured (no-op in dev).
initSentry()

function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          {/* Inside ThemeProvider so the themed fallback turns an uncaught
              render error into a recoverable screen, not a blank crash. */}
          <Sentry.ErrorBoundary
            fallback={({ resetError }) => (
              <RootErrorFallback onRetry={resetError} />
            )}
          >
            <MobileAppStateProvider>
              <CloudAuthProvider>
                <RootNavigator />
              </CloudAuthProvider>
            </MobileAppStateProvider>
          </Sentry.ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function RootErrorFallback({
  onRetry,
}: {
  onRetry: () => void
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <View style={[styles.fallback, { backgroundColor: tokens.bg }]}>
      <StatusBar style="light" />
      <Text style={[styles.fallbackTitle, { color: tokens.text1 }]}>
        Something went wrong
      </Text>
      <Text style={[styles.fallbackBody, { color: tokens.text2 }]}>
        The app hit an unexpected error. You can try again — if it keeps
        happening, reopen the app.
      </Text>
      <View style={styles.fallbackAction}>
        <PrimaryButton title="Try again" onPress={onRetry} />
      </View>
    </View>
  )
}

export default Sentry.wrap(RootLayout)

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
  fallback: {
    flex: 1,
    alignItems: `center`,
    justifyContent: `center`,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  fallbackTitle: {
    fontSize: fontSize.xl,
    fontWeight: `600`,
    lineHeight: lineHeight.xl,
    textAlign: `center`,
  },
  fallbackBody: {
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    textAlign: `center`,
  },
  fallbackAction: {
    alignSelf: `stretch`,
    marginTop: spacing.sm,
  },
})
