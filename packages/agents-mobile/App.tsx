import { useEffect, useMemo, useState, type ComponentType } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AgentsProvider, useAgents } from './src/lib/AgentsProvider'
import {
  ThemeProvider,
  useColorSchemeMode,
  useTokens,
} from './src/lib/ThemeProvider'
import { DiagnosticsScreen } from './src/screens/DiagnosticsScreen'
import { NewSessionScreen } from './src/screens/NewSessionScreen'
import { ServerSetupScreen } from './src/screens/ServerSetupScreen'
import { SessionListScreen } from './src/screens/SessionListScreen'
import {
  CHAT_COMPOSER_BASE_HEIGHT,
  CHAT_COMPOSER_OVERLAP,
  ChatSessionScreen,
  StateInspectorSessionScreen,
} from './src/screens/SessionScreen'
import type { EmbedViewId } from './src/lib/embedView'
import SessionChatLogDomEmbedModule from '@electric-ax/agents-server-ui/src/embed/SessionChatLogDomEmbed'
import SessionStateInspectorDomEmbedModule from '@electric-ax/agents-server-ui/src/embed/SessionStateInspectorDomEmbed'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`

type SessionDomEmbedProps = {
  serverUrl: string
  entityUrl: string
  theme: `light` | `dark`
  scrollToBottomSignal?: number
  onRequestOpenEntity: (entityUrl: string) => Promise<void>
  style?: StyleProp<ViewStyle>
  matchContents?: boolean
  dom?: unknown
}

// Treat the Expo DOM component as an opaque runtime boundary from the native
// package. Letting `tsc` follow this source import pulls in duplicate
// TanStack DB type identities under pnpm; Metro still sees the real module.
const SessionChatLogDomEmbed =
  SessionChatLogDomEmbedModule as ComponentType<SessionDomEmbedProps>
const SessionStateInspectorDomEmbed =
  SessionStateInspectorDomEmbedModule as ComponentType<SessionDomEmbedProps>

/**
 * Pixel height of the `<Header>` strip — kept in lockstep with
 * `rowHeight.xl` (44px) so we can position the DOM component directly
 * below it without measuring at runtime. If you change the header
 * height in `Header.tsx`, change this constant too.
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
 * intercepted before we get there so the embed never has to worry about
 * a missing serverUrl.
 */
type ShellRoute = Exclude<Route, { name: `server-setup` }>

export default function App(): React.ReactElement {
  return (
    // SafeAreaProvider is required for `react-native-safe-area-context`
    // hooks/components to read insets on iOS notches and Android
    // edge-to-edge mode (set via `android.edgeToEdgeEnabled` in
    // `app.json`).
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
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
 *   2. An Expo DOM component that renders the server UI session surface.
 *
 * The native shell still owns the chrome (header, back button, view toggle).
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
  const { serverUrl } = useAgents()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const insets = useSafeAreaInsets()
  const windowDimensions = useWindowDimensions()
  const keyboardInset = useKeyboardBottomInset(windowDimensions.height)
  const [chatComposerHeight, setChatComposerHeight] = useState(
    CHAT_COMPOSER_BASE_HEIGHT + insets.bottom
  )
  const [chatLogScrollSignal, setChatLogScrollSignal] = useState(0)
  // The DOM component slots into the body of `SessionScreen`,
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
  const composerInset =
    active?.view === `chat`
      ? Math.max(0, chatComposerHeight + keyboardInset - CHAT_COMPOSER_OVERLAP)
      : 0
  const embedFrame = useMemo(
    () => ({
      top: embedTop,
      width: windowDimensions.width,
      height: Math.max(0, windowDimensions.height - embedTop - composerInset),
    }),
    [composerInset, embedTop, windowDimensions.height, windowDimensions.width]
  )
  const embedSize = useMemo(
    () => ({
      width: embedFrame.width,
      height: embedFrame.height,
    }),
    [embedFrame.height, embedFrame.width]
  )
  return (
    <View style={[styles.shell, { backgroundColor: tokens.bg }]}>
      {active && (
        <View
          style={[
            styles.domEmbedHost,
            embedFrame,
            { backgroundColor: tokens.bg },
          ]}
        >
          {active.view === `chat` ? (
            <SessionChatLogDomEmbed
              style={[styles.domEmbedWeb, embedSize]}
              matchContents={false}
              serverUrl={serverUrl}
              entityUrl={active.entityUrl}
              theme={scheme}
              scrollToBottomSignal={chatLogScrollSignal}
              onRequestOpenEntity={async (target) => onOpenSession(target)}
              dom={{
                useExpoDOMWebView: false,
                matchContents: false,
                scrollEnabled: false,
                bounces: false,
                automaticallyAdjustContentInsets: false,
                automaticallyAdjustsScrollIndicatorInsets: false,
                contentInsetAdjustmentBehavior: `never`,
                style: [
                  styles.domEmbedWeb,
                  embedSize,
                  { backgroundColor: tokens.bg },
                ],
                containerStyle: [
                  styles.domEmbedWeb,
                  embedSize,
                  { backgroundColor: tokens.bg },
                ],
              }}
            />
          ) : (
            <SessionStateInspectorDomEmbed
              style={[styles.domEmbedWeb, embedSize]}
              matchContents={false}
              serverUrl={serverUrl}
              entityUrl={active.entityUrl}
              theme={scheme}
              onRequestOpenEntity={async (target) => onOpenSession(target)}
              dom={{
                useExpoDOMWebView: false,
                matchContents: false,
                scrollEnabled: false,
                bounces: false,
                automaticallyAdjustContentInsets: false,
                automaticallyAdjustsScrollIndicatorInsets: false,
                contentInsetAdjustmentBehavior: `never`,
                style: [
                  styles.domEmbedWeb,
                  embedSize,
                  { backgroundColor: tokens.bg },
                ],
                containerStyle: [
                  styles.domEmbedWeb,
                  embedSize,
                  { backgroundColor: tokens.bg },
                ],
              }}
            />
          )}
        </View>
      )}

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
      ) : route.view === `chat` ? (
        <ChatSessionScreen
          entityUrl={route.entityUrl}
          onBack={onBackToSessions}
          onSetView={onSetView}
          onComposerHeightChange={setChatComposerHeight}
          onSendMessage={() => setChatLogScrollSignal(Date.now())}
        />
      ) : (
        <StateInspectorSessionScreen
          entityUrl={route.entityUrl}
          onBack={onBackToSessions}
          onSetView={onSetView}
        />
      )}
    </View>
  )
}

function useKeyboardBottomInset(windowHeight: number): number {
  const [keyboardInset, setKeyboardInset] = useState(0)

  useEffect(() => {
    const showOrChange = (event: KeyboardEvent): void => {
      Keyboard.scheduleLayoutAnimation(event)
      setKeyboardInset(Math.max(0, windowHeight - event.endCoordinates.screenY))
    }
    const hide = (event?: KeyboardEvent): void => {
      if (event) Keyboard.scheduleLayoutAnimation(event)
      setKeyboardInset(0)
    }

    const subscriptions =
      Platform.OS === `ios`
        ? [
            Keyboard.addListener(`keyboardWillChangeFrame`, showOrChange),
            Keyboard.addListener(`keyboardWillHide`, hide),
          ]
        : [
            Keyboard.addListener(`keyboardDidShow`, showOrChange),
            Keyboard.addListener(`keyboardDidHide`, hide),
          ]

    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [windowHeight])

  return keyboardInset
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
  domEmbedHost: {
    position: `absolute`,
    left: 0,
    overflow: `hidden`,
    display: `flex`,
    zIndex: 0,
  },
  domEmbedWeb: {
    flex: 1,
    alignSelf: `stretch`,
    overflow: `hidden`,
  },
})
