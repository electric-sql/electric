import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Ref,
} from 'react'
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
import type { ForkPointer } from '../src/lib/agentsClient'
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
import type { SessionChatLogDomRef } from '@electric-ax/agents-server-ui/src/embed/sessionChatLogDomRef'
import SessionStateInspectorDomEmbedModule from '@electric-ax/agents-server-ui/src/embed/SessionStateInspectorDomEmbed'
import { getActiveServerHeadersSnapshot } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import type { OptimisticInboxMessage } from '@electric-ax/agents-server-ui/src/lib/sendMessage'

const HEADER_HEIGHT = 44

type SessionDomEmbedProps = {
  serverUrl: string
  entityUrl: string
  theme: `light` | `dark`
  bottomInset?: number
  onRequestOpenEntity: (entityUrl: string) => Promise<void>
  // Marshalled so the per-message fork runs over native networking.
  onRequestForkEntity?: (
    entityUrl: string,
    opts?: { pointer?: ForkPointer }
  ) => Promise<{ url: string }>
  style?: StyleProp<ViewStyle>
  matchContents?: boolean
  serverHeaders?: { url: string; headers: Record<string, string> } | null
  ref?: Ref<SessionChatLogDomRef>
  dom?: unknown
}

// The timeline is an Expo DOM (WebView) embed that re-posts — and visibly
// flickers — on any prop change or re-render. So we memo it, keep every prop
// below reference-stable, and push the values that actually change (bottom
// inset, queued messages, scroll) imperatively via the ref, not as props.
const SessionChatLogDomEmbed = memo(
  SessionChatLogDomEmbedModule as ComponentType<SessionDomEmbedProps>
)
const SessionStateInspectorDomEmbed = memo(
  SessionStateInspectorDomEmbedModule as ComponentType<SessionDomEmbedProps>
)

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
  const { serverUrl, forkEntity } = useAgents()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const insets = useSafeAreaInsets()
  const windowDimensions = useWindowDimensions()
  const keyboardInset = useKeyboardBottomInset(windowDimensions.height)
  const [chatComposerHeight, setChatComposerHeight] = useState(
    CHAT_COMPOSER_BASE_HEIGHT + insets.bottom
  )
  const [inlineQueuedMessages, setInlineQueuedMessages] = useState<
    Array<OptimisticInboxMessage>
  >([])

  const entityUrl = Array.isArray(params.entityUrl)
    ? params.entityUrl[0]
    : (params.entityUrl ?? ``)
  const view = params.view === `state-explorer` ? `state-explorer` : `chat`

  // A fresh object each call, so memo on its serialized value: stable identity
  // across renders, but still updates if the auth headers actually change.
  const serverHeadersSnapshot = getActiveServerHeadersSnapshot()
  const serverHeadersKey = serverHeadersSnapshot
    ? JSON.stringify(serverHeadersSnapshot)
    : ``
  const serverHeaders = useMemo(() => serverHeadersSnapshot, [serverHeadersKey])

  const embedTop = insets.top + HEADER_HEIGHT
  const composerInset =
    view === `chat`
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
  const embedStyle = useMemo(() => [styles.domEmbedWeb, embedSize], [embedSize])
  const embedDom = useMemo(
    () => domOptions(styles, embedSize, tokens.bg),
    [embedSize, tokens.bg]
  )
  // The inset is also seeded once as a prop so the first paint is correct before
  // the imperative handle (which registers after boot) takes over.
  const chatLogRef = useRef<SessionChatLogDomRef>(null)
  const initialComposerInsetRef = useRef(composerInset)
  usePushToEmbed(chatLogRef, `setBottomInset`, composerInset)
  usePushToEmbed(chatLogRef, `setInlineQueuedMessages`, inlineQueuedMessages)
  const handleSend = useCallback((): void => {
    // `?.()` guards the method too: the handle may not be registered yet.
    chatLogRef.current?.scrollToBottom?.()
  }, [])
  // Reference-stable so it doesn't break the embed's memo (forkEntity itself is
  // stable from the provider); marshals the fork over native networking.
  const handleForkEntity = useCallback(
    (targetUrl: string, opts?: { pointer?: ForkPointer }) =>
      forkEntity({ entityUrl: targetUrl, pointer: opts?.pointer }),
    [forkEntity]
  )

  const goBack = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace(`/`)
  }
  const openSession = useCallback(
    async (target: string): Promise<void> => {
      router.push({
        pathname: `/session`,
        params: { entityUrl: target, view: `chat` },
      })
    },
    [router]
  )
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
        {view === `chat` ? (
          <SessionChatLogDomEmbed
            ref={chatLogRef}
            style={embedStyle}
            matchContents={false}
            serverUrl={serverUrl}
            entityUrl={entityUrl}
            theme={scheme}
            bottomInset={initialComposerInsetRef.current}
            serverHeaders={serverHeaders}
            onRequestOpenEntity={openSession}
            onRequestForkEntity={handleForkEntity}
            dom={embedDom}
          />
        ) : (
          <SessionStateInspectorDomEmbed
            style={embedStyle}
            matchContents={false}
            serverUrl={serverUrl}
            entityUrl={entityUrl}
            theme={scheme}
            serverHeaders={serverHeaders}
            onRequestOpenEntity={openSession}
            dom={embedDom}
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
          onSendMessage={handleSend}
          onInlineQueuedMessagesChange={setInlineQueuedMessages}
          onShare={openShare}
        />
      ) : (
        <StateInspectorSessionScreen
          entityUrl={entityUrl}
          onBack={goBack}
          onSetView={setView}
          onOpenEntity={openSession}
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

// Push a value into the chat-log embed's imperative handle, retrying on
// animation frames until the method exists. `ref.current` becomes a truthy
// proxy a beat BEFORE `useDOMImperativeHandle` marshals its methods in, so we
// must check the method itself — a truthy `ref.current` is not enough.
function usePushToEmbed(
  ref: { current: SessionChatLogDomRef | null },
  method: `setBottomInset` | `setInlineQueuedMessages`,
  value: unknown
): void {
  useEffect(() => {
    let frame = 0
    let attempts = 0
    const apply = (): void => {
      const fn = ref.current?.[method]
      if (typeof fn === `function`) {
        fn(value)
        return
      }
      if (attempts++ < 120) frame = requestAnimationFrame(apply)
    }
    apply()
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, method, value])
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
