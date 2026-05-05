import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { Badge, type BadgeTone } from '../components/Badge'
import { Header, HeaderBackButton } from '../components/Header'
import { IconToggle } from '../components/IconToggle'
import { Screen } from '../components/Screen'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle, type ElectricEntity } from '../lib/agentsClient'
import { useColorSchemeMode, useTokens } from '../lib/ThemeProvider'
import { fontSize, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import { useEmbedSource, type EmbedViewId } from '../webview/embedSource'
import { encodeNativeToEmbed, parseEmbedMessage } from '../webview/bridge'

type WebState = `loading` | `ready` | `error`

const STATUS_TONE: Record<string, BadgeTone> = {
  running: `info`,
  idle: `success`,
  spawning: `warning`,
  stopped: `neutral`,
}

export function SessionScreen({
  entityUrl,
  initialView,
  onBack,
  onOpenEntity,
}: {
  entityUrl: string
  initialView: EmbedViewId
  onBack: () => void
  onOpenEntity?: (entityUrl: string) => void
}): React.ReactElement {
  const { entitiesCollection, serverUrl } = useAgents()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [view, setView] = useState<EmbedViewId>(initialView)
  const [webState, setWebState] = useState<WebState>(`loading`)
  const webRef = useRef<WebView>(null)

  // Live `set-*` updates to the embed. Each effect re-runs when its
  // topic changes OR when the embed finishes booting (`ready`), so the
  // very first commit lands the right state even if the user toggled
  // before the WebView was ready. We deliberately only post AFTER
  // `ready` — iOS WKWebView will silently drop messages that arrive
  // before the page has finished loading.
  useEffect(() => {
    if (webState !== `ready`) return
    webRef.current?.postMessage(encodeNativeToEmbed({ type: `set-view`, view }))
  }, [view, webState])

  useEffect(() => {
    if (webState !== `ready`) return
    webRef.current?.postMessage(
      encodeNativeToEmbed({ type: `set-entity`, entityUrl })
    )
  }, [entityUrl, webState])

  useEffect(() => {
    if (webState !== `ready`) return
    webRef.current?.postMessage(
      encodeNativeToEmbed({ type: `set-theme`, theme: scheme })
    )
  }, [scheme, webState])

  // Snap the local view tab back to whatever a navigation handed us
  // (e.g. opening a related entity always lands on `chat`).
  useEffect(() => {
    setView(initialView)
  }, [initialView])

  const { data: matches = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .where(({ entity }) => eq(entity.url, entityUrl)),
    [entitiesCollection, entityUrl]
  )
  const entity = matches.at(0) ?? null

  const embed = useEmbedSource({
    serverUrl,
    entityUrl,
    view,
    theme: scheme,
  })

  const handleMessage = (event: WebViewMessageEvent) => {
    const message = parseEmbedMessage(event.nativeEvent.data)
    if (!message) return
    switch (message.type) {
      case `ready`:
        setWebState(`ready`)
        return
      case `error`:
        setWebState(`error`)
        return
      case `navigate`: {
        const match = /^\/entity(\/.+)$/.exec(message.pathname)
        const target = match?.[1]
        if (target && target !== entityUrl) onOpenEntity?.(target)
        return
      }
    }
  }

  return (
    <Screen>
      {/*
        Mirrors `<EntityHeader>` which composes `<MainHeader>`:
        44px row, page bg, no border. Title block on the left
        (entity title + sessionId mono subtitle), actions cluster
        on the right (status badge + view-toggle icons).
      */}
      <Header
        leading={<HeaderBackButton onPress={onBack} label="Sessions" />}
        title={<EntityTitle entity={entity} entityUrl={entityUrl} />}
        actions={
          <View style={styles.actions}>
            {entity && (
              <Badge tone={STATUS_TONE[entity.status] ?? `neutral`}>
                {entity.status}
              </Badge>
            )}
            <IconToggle
              active={view === `chat`}
              onPress={() => setView(`chat`)}
              accessibilityLabel="Chat"
            >
              <Glyph color={view === `chat` ? tokens.text1 : tokens.text2}>
                ◧
              </Glyph>
            </IconToggle>
            <IconToggle
              active={view === `state-explorer`}
              onPress={() => setView(`state-explorer`)}
              accessibilityLabel="State explorer"
            >
              <Glyph
                color={view === `state-explorer` ? tokens.text1 : tokens.text2}
              >
                ⛁
              </Glyph>
            </IconToggle>
          </View>
        }
      />

      {/*
        KeyboardAvoidingView keeps the chat composer (which lives at the
        bottom of the embed's HTML) visible above the iOS keyboard.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === `ios` ? `padding` : undefined}
        style={styles.keyboardWrap}
      >
        {embed.uri ? (
          <WebView
            ref={webRef}
            // Stable key — entityUrl/view/theme changes are routed
            // through `set-*` messages, so the multi-MB bundle never
            // has to re-parse on routine navigation.
            key={embed.uri}
            originWhitelist={[`*`]}
            source={{ uri: embed.uri }}
            injectedJavaScriptBeforeContentLoaded={
              embed.injectedJavaScriptBeforeContentLoaded
            }
            onMessage={handleMessage}
            onLoadStart={() => setWebState(`loading`)}
            onError={() => setWebState(`error`)}
            javaScriptEnabled
            domStorageEnabled
            // The embed asset is loaded via `file://`. These flags let
            // the page open cross-origin XHR / fetch / SSE against the
            // configured agents server (CORS on the server side already
            // returns `Access-Control-Allow-Origin: *`).
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            keyboardDisplayRequiresUserAction={false}
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            contentInsetAdjustmentBehavior="never"
            scrollEnabled
            bounces={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            allowsBackForwardNavigationGestures={false}
            style={styles.webview}
            containerStyle={styles.webviewContainer}
          />
        ) : (
          <View style={styles.loadingOverlay}>
            {embed.error ? (
              <Text style={styles.errorText}>{embed.error.message}</Text>
            ) : (
              <ActivityIndicator color={tokens.text3} />
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  )
}

function EntityTitle({
  entity,
  entityUrl,
}: {
  entity: ElectricEntity | null
  entityUrl: string
}): React.ReactElement {
  const tokens = useTokens()
  const sessionId = entityUrl.replace(/^\//, ``)
  const title = entity
    ? getEntityDisplayTitle(entity)
    : decodeURIComponent(sessionId)

  return (
    <View
      style={{
        flexDirection: `row`,
        alignItems: `baseline`,
        gap: spacing.sm,
        minWidth: 0,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: tokens.text1,
          fontSize: fontSize.base,
          fontWeight: `500`,
        }}
      >
        {title}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: tokens.text3,
          fontSize: fontSize.sm,
          fontFamily: Platform.OS === `ios` ? `Menlo` : `monospace`,
        }}
      >
        {sessionId}
      </Text>
    </View>
  )
}

function Glyph({
  children,
  color,
}: {
  children: string
  color: string
}): React.ReactElement {
  return <Text style={{ color, fontSize: 14, lineHeight: 16 }}>{children}</Text>
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    actions: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 2,
    },
    keyboardWrap: {
      flex: 1,
    },
    webview: {
      flex: 1,
      backgroundColor: tokens.bg,
    },
    webviewContainer: {
      flex: 1,
      backgroundColor: tokens.bg,
    },
    loadingOverlay: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      padding: spacing.lg,
      backgroundColor: tokens.bg,
    },
    errorText: {
      color: tokens.red11,
      fontSize: fontSize.sm,
      textAlign: `center`,
    },
  })
}
