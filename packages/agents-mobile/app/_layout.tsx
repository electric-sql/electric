import * as React from 'react'
import { Redirect, Stack, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Linking from 'expo-linking'
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native'
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
import { debugCloudAuth, isCallbackUrl } from '../src/lib/cloudAuth'

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

  useStartupLinkDebug({
    loading,
    serverUrl,
    onboardingDismissed,
    pathname,
    launchUrl,
    coldStartOAuthCallback,
  })

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: tokens.bg }]}>
        <StatusBar style={statusBarStyle} />
        <ActivityIndicator color={tokens.accent11} />
      </View>
    )
  }

  if (coldStartOAuthCallback) {
    debugCloudAuth(`rootNavigator:redirectToCallback`, {
      launchUrl,
      pathname,
    })
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

function useStartupLinkDebug({
  loading,
  serverUrl,
  onboardingDismissed,
  pathname,
  launchUrl,
  coldStartOAuthCallback,
}: {
  loading: boolean
  serverUrl: string | null
  onboardingDismissed: boolean
  pathname: string
  launchUrl: string | null
  coldStartOAuthCallback: boolean
}): void {
  React.useEffect(() => {
    debugCloudAuth(`rootNavigator:renderState`, {
      loading,
      serverUrl,
      onboardingDismissed,
      pathname,
      launchUrl,
      coldStartOAuthCallback,
    })
  }, [
    loading,
    serverUrl,
    onboardingDismissed,
    pathname,
    launchUrl,
    coldStartOAuthCallback,
  ])

  React.useEffect(() => {
    void Linking.getInitialURL()
      .then((url) => {
        debugCloudAuth(`rootNavigator:getInitialURL`, { url, pathname })
      })
      .catch((error) => {
        debugCloudAuth(`rootNavigator:getInitialURL:error`, {
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }, [pathname])

  React.useEffect(() => {
    const subscription = Linking.addEventListener(`url`, ({ url }) => {
      debugCloudAuth(`rootNavigator:linkingEvent`, { url, pathname })
    })
    return () => subscription.remove()
  }, [pathname])

  React.useEffect(() => {
    const subscription = AppState.addEventListener(`change`, (nextState) => {
      debugCloudAuth(`rootNavigator:appState`, { nextState, pathname })
      void Linking.getInitialURL()
        .then((url) => {
          debugCloudAuth(`rootNavigator:appState:getInitialURL`, {
            nextState,
            url,
            pathname,
          })
        })
        .catch((error) => {
          debugCloudAuth(`rootNavigator:appState:getInitialURL:error`, {
            nextState,
            pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    })
    return () => subscription.remove()
  }, [pathname])
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
