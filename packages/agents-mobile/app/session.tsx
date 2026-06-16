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
import { useAgentsRouteGuard } from '../src/lib/useAgentsRouteGuard'
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
import { getActiveServerHeadersSnapshot } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import type { OptimisticInboxMessage } from '@electric-ax/agents-server-ui/src/lib/sendMessage'
import type {
  EntityTimelineCommentRow,
  SelectedCommentTarget,
} from '@electric-ax/agents-server-ui/src/lib/comments'

const HEADER_HEIGHT = 44

type SessionDomEmbedProps = {
  serverUrl: string
  entityUrl: string
  theme: `light` | `dark`
  scrollToBottomSignal?: number
  inlineQueuedMessages?: Array<OptimisticInboxMessage>
  inlineComments?: Array<EntityTimelineCommentRow>
  bottomInset?: number
  commentsOnly?: boolean
  onRequestOpenEntity: (entityUrl: string) => Promise<void>
  onRequestReplyToComment?: (target: SelectedCommentTarget) => void
  style?: StyleProp<ViewStyle>
  matchContents?: boolean
  serverHeaders?: { url: string; headers: Record<string, string> } | null
  dom?: unknown
}

const SessionChatLogDomEmbed =
  SessionChatLogDomEmbedModule as ComponentType<SessionDomEmbedProps>
const SessionStateInspectorDomEmbed =
  SessionStateInspectorDomEmbedModule as ComponentType<SessionDomEmbedProps>

export default function SessionRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<{
    entityUrl?: string
    view?: EmbedViewId
  }>()
  const router = useRouter()
  const guard = useAgentsRouteGuard()
  if (guard) return guard
  return <SessionRouteInner params={params} router={router} />
}

function SessionRouteInner({
  params,
  router,
}: {
  params: {
    entityUrl?: string | Array<string>
    view?: EmbedViewId
  }
  router: ReturnType<typeof useRouter>
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
  const [inlineQueuedMessages, setInlineQueuedMessages] = useState<
    Array<OptimisticInboxMessage>
  >([])
  const [inlineComments, setInlineComments] = useState<
    Array<EntityTimelineCommentRow>
  >([])
  const [replyTarget, setReplyTarget] = useState<SelectedCommentTarget | null>(
    null
  )

  const entityUrl = Array.isArray(params.entityUrl)
    ? params.entityUrl[0]
    : (params.entityUrl ?? ``)
  const view: EmbedViewId =
    params.view === `state-explorer`
      ? `state-explorer`
      : params.view === `comments`
        ? `comments`
        : `chat`

  // Drop any pending reply target when the session or view changes.
  useEffect(() => {
    setReplyTarget(null)
  }, [entityUrl, view])

  // Read once per render — the DOM embed receives this as a prop and
  // re-registers it on its side of the JS-context boundary.
  const serverHeaders = getActiveServerHeadersSnapshot()

  const embedTop = insets.top + HEADER_HEIGHT
  const composerInset =
    view !== `state-explorer`
      ? Math.max(0, chatComposerHeight + keyboardInset - CHAT_COMPOSER_OVERLAP)
      : 0
  const embedFrame = useMemo(
    () => ({
      top: embedTop,
      width: windowDimensions.width,
      height: Math.max(0, windowDimensions.height - embedTop),
    }),
    [embedTop, windowDimensions.height, windowDimensions.width]
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
  const openShare = (): void => {
    router.push({ pathname: `/session-share`, params: { entityUrl } })
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
        {view !== `state-explorer` ? (
          <SessionChatLogDomEmbed
            style={[styles.domEmbedWeb, embedSize]}
            matchContents={false}
            serverUrl={serverUrl}
            entityUrl={entityUrl}
            theme={scheme}
            scrollToBottomSignal={chatLogScrollSignal}
            inlineQueuedMessages={inlineQueuedMessages}
            inlineComments={inlineComments}
            bottomInset={composerInset}
            commentsOnly={view === `comments`}
            serverHeaders={serverHeaders}
            onRequestOpenEntity={async (target) => openSession(target)}
            onRequestReplyToComment={(target) => setReplyTarget(target)}
            dom={domOptions(styles, embedSize, tokens.bg)}
          />
        ) : (
          <SessionStateInspectorDomEmbed
            style={[styles.domEmbedWeb, embedSize]}
            matchContents={false}
            serverUrl={serverUrl}
            entityUrl={entityUrl}
            theme={scheme}
            serverHeaders={serverHeaders}
            onRequestOpenEntity={async (target) => openSession(target)}
            dom={domOptions(styles, embedSize, tokens.bg)}
          />
        )}
      </View>

      {view !== `state-explorer` ? (
        <ChatSessionScreen
          entityUrl={entityUrl}
          view={view}
          onBack={goBack}
          onSetView={setView}
          onOpenEntity={openSession}
          onOpenStateSource={openStateSource}
          onComposerHeightChange={setChatComposerHeight}
          onSendMessage={() => setChatLogScrollSignal(Date.now())}
          onInlineQueuedMessagesChange={setInlineQueuedMessages}
          onInlineCommentsChange={setInlineComments}
          onShare={openShare}
          commentTarget={replyTarget}
          onClearCommentTarget={() => setReplyTarget(null)}
        />
      ) : (
        <StateInspectorSessionScreen
          entityUrl={entityUrl}
          onBack={goBack}
          onSetView={setView}
          onShare={openShare}
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
  const backgroundStyle = [styles.domEmbedWeb, embedSize, { backgroundColor }]

  return {
    useExpoDOMWebView: false,
    matchContents: false,
    scrollEnabled: false,
    bounces: false,
    automaticallyAdjustContentInsets: false,
    automaticallyAdjustsScrollIndicatorInsets: false,
    contentInsetAdjustmentBehavior: `never`,
    // The native WebView briefly paints its own default background while the
    // DOM bundle boots. Keep every layer themed so route transitions to a
    // stream don't flash white, especially in dark mode.
    backgroundColor,
    style: backgroundStyle,
    containerStyle: backgroundStyle,
    webViewStyle: backgroundStyle,
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
