import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { useAgents } from '../lib/AgentsProvider'
import { useColorSchemeMode, useTokens } from '../lib/ThemeProvider'
import { fontSize, spacing } from '../lib/theme'
import { encodeNativeToEmbed, parseEmbedMessage } from './bridge'
import { useEmbedSource, type EmbedViewId } from './embedSource'

export type PersistentEmbedActive = {
  entityUrl: string
  view: EmbedViewId
}

type WebState = `loading` | `ready` | `error`

/**
 * App-level WebView that survives screen navigation.
 *
 * Rendered once near the root of the tree, the WebView is hidden via
 * `display: 'none'` when not on a session screen and revealed when
 * `active` is non-null. The multi-MB embed bundle therefore parses
 * exactly once per app launch — every subsequent open of a session
 * screen is just a `set-entity` + `set-view` postMessage away.
 *
 * The native shell still owns the chrome (back button, view toggle,
 * status badge): this component renders only the WebView body, and the
 * caller is responsible for laying it out below the header (typically
 * via `style.top = headerHeight`).
 */
export function PersistentEmbed({
  active,
  containerStyle,
  onNavigateToEntity,
}: {
  active: PersistentEmbedActive | null
  containerStyle?: { top?: number }
  onNavigateToEntity: (entityUrl: string) => void
}): React.ReactElement {
  const { serverUrl } = useAgents()
  const tokens = useTokens()
  const scheme = useColorSchemeMode()
  const [webState, setWebState] = useState<WebState>(`loading`)
  const webRef = useRef<WebView>(null)
  // Latest entity navigation handler — kept in a ref so the message
  // handler doesn't need to be re-bound across renders.
  const onNavigateRef = useRef(onNavigateToEntity)
  onNavigateRef.current = onNavigateToEntity

  // Keep track of the last-known entity inside the WebView so we know
  // whether a fresh `navigate` is "go to a different session" vs. a
  // no-op self-link.
  const lastEntityUrlRef = useRef<string | null>(active?.entityUrl ?? null)

  // First-paint config — frozen for the lifetime of the WebView.
  // After mount, every change flows through `set-*` postMessages.
  const initialConfigRef = useRef({
    serverUrl,
    entityUrl: active?.entityUrl ?? ``,
    view: active?.view ?? `chat`,
    theme: scheme,
  })
  const embed = useEmbedSource(initialConfigRef.current)

  // Live updates — gated on `ready` so iOS WKWebView doesn't drop the
  // message into a not-yet-loaded page. Re-runs whenever the topic
  // changes OR when the embed transitions to `ready` so the first
  // commit always lands.
  useEffect(() => {
    if (webState !== `ready` || !active) return
    webRef.current?.postMessage(
      encodeNativeToEmbed({ type: `set-entity`, entityUrl: active.entityUrl })
    )
    lastEntityUrlRef.current = active.entityUrl
  }, [webState, active?.entityUrl])

  useEffect(() => {
    if (webState !== `ready` || !active) return
    webRef.current?.postMessage(
      encodeNativeToEmbed({ type: `set-view`, view: active.view })
    )
  }, [webState, active?.view])

  useEffect(() => {
    if (webState !== `ready`) return
    webRef.current?.postMessage(
      encodeNativeToEmbed({ type: `set-theme`, theme: scheme })
    )
  }, [scheme, webState])

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
        if (!target) return
        if (target === lastEntityUrlRef.current) return
        onNavigateRef.current(target)
        return
      }
    }
  }

  // We hide via `display: 'none'` rather than unmounting so the JS
  // context, the SSE stream and the in-embed state all persist across
  // native navigations. iOS WKWebView keeps timers running while
  // hidden, so the connection stays warm.
  const visible = active !== null
  const top = containerStyle?.top ?? 0

  return (
    <View
      pointerEvents={visible ? `auto` : `none`}
      style={[
        styles.host,
        { top, backgroundColor: tokens.bg },
        visible ? styles.visible : styles.hidden,
      ]}
    >
      {embed.uri ? (
        <WebView
          ref={webRef}
          // Stable key — the embed never reloads after mount; all
          // updates go through the `set-*` bridge.
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
          style={[styles.web, { backgroundColor: tokens.bg }]}
          containerStyle={[styles.web, { backgroundColor: tokens.bg }]}
        />
      ) : (
        <View style={[styles.loading, { backgroundColor: tokens.bg }]}>
          {embed.error ? (
            <Text style={[styles.errorText, { color: tokens.red11 }]}>
              {embed.error.message}
            </Text>
          ) : (
            <ActivityIndicator color={tokens.text3} />
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  host: {
    position: `absolute`,
    left: 0,
    right: 0,
    bottom: 0,
  },
  visible: {
    // Use `flex` so the inner WebView stretches to fill the host.
    display: `flex`,
  },
  hidden: {
    display: `none`,
  },
  web: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: `center`,
    justifyContent: `center`,
    padding: spacing.lg,
  },
  errorText: {
    fontSize: fontSize.sm,
    textAlign: `center`,
  },
})

export type { EmbedViewId } from './embedSource'
