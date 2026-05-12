import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Keyboard,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAgents } from '../src/lib/AgentsProvider'
import { useColorSchemeMode, useTokens } from '../src/lib/ThemeProvider'
import {
  CHAT_COMPOSER_BASE_HEIGHT,
  CHAT_COMPOSER_OVERLAP,
  ChatSessionScreen,
  StateInspectorSessionScreen,
} from '../src/screens/SessionScreen'
import type { EmbedViewId } from '../src/lib/embedView'
import SessionChatLogDomEmbedModule from '@electric-ax/agents-server-ui/src/embed/SessionChatLogDomEmbed'
import SessionStateInspectorDomEmbedModule from '@electric-ax/agents-server-ui/src/embed/SessionStateInspectorDomEmbed'

const HEADER_HEIGHT = 44

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

const SessionChatLogDomEmbed =
  SessionChatLogDomEmbedModule as ComponentType<SessionDomEmbedProps>
const SessionStateInspectorDomEmbed =
  SessionStateInspectorDomEmbedModule as ComponentType<SessionDomEmbedProps>

export default function SessionRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    entityUrl?: string
    view?: EmbedViewId
  }>()
  const router = useRouter()
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

  const entityUrl = Array.isArray(params.entityUrl)
    ? params.entityUrl[0]
    : (params.entityUrl ?? ``)
  const view = params.view === `state-explorer` ? `state-explorer` : `chat`

  const embedTop = insets.top + HEADER_HEIGHT
  const composerInset =
    view === `chat`
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

  const goBack = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace(`/`)
  }
  const openSession = (target: string): void => {
    router.push({
      pathname: `/session`,
      params: { entityUrl: target, view: `chat` },
    })
  }
  const setView = (next: EmbedViewId): void => {
    router.setParams({ view: next })
  }
  const openStateSource = (_sourceId: string): void => {
    router.setParams({ view: `state-explorer` })
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.bg }]}>
      <View
        style={[
          styles.domEmbedHost,
          embedFrame,
          { backgroundColor: tokens.bg },
        ]}
      >
        {view === `chat` ? (
          <SessionChatLogDomEmbed
            style={[styles.domEmbedWeb, embedSize]}
            matchContents={false}
            serverUrl={serverUrl}
            entityUrl={entityUrl}
            theme={scheme}
            scrollToBottomSignal={chatLogScrollSignal}
            onRequestOpenEntity={async (target) => openSession(target)}
            dom={domOptions(styles, embedSize, tokens.bg)}
          />
        ) : (
          <SessionStateInspectorDomEmbed
            style={[styles.domEmbedWeb, embedSize]}
            matchContents={false}
            serverUrl={serverUrl}
            entityUrl={entityUrl}
            theme={scheme}
            onRequestOpenEntity={async (target) => openSession(target)}
            dom={domOptions(styles, embedSize, tokens.bg)}
          />
        )}
      </View>

      {view === `chat` ? (
        <ChatSessionScreen
          entityUrl={entityUrl}
          onBack={goBack}
          onSetView={setView}
          onOpenEntity={openSession}
          onOpenStateSource={openStateSource}
          onComposerHeightChange={setChatComposerHeight}
          onSendMessage={() => setChatLogScrollSignal(Date.now())}
        />
      ) : (
        <StateInspectorSessionScreen
          entityUrl={entityUrl}
          onBack={goBack}
          onSetView={setView}
        />
      )}
    </View>
  )
}

function domOptions(
  styles: typeof sessionStyles,
  embedSize: { width: number; height: number },
  backgroundColor: string
) {
  return {
    useExpoDOMWebView: false,
    matchContents: false,
    scrollEnabled: false,
    bounces: false,
    automaticallyAdjustContentInsets: false,
    automaticallyAdjustsScrollIndicatorInsets: false,
    contentInsetAdjustmentBehavior: `never`,
    style: [styles.domEmbedWeb, embedSize, { backgroundColor }],
    containerStyle: [styles.domEmbedWeb, embedSize, { backgroundColor }],
  }
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

const sessionStyles = StyleSheet.create({
  root: {
    flex: 1,
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

const styles = sessionStyles
