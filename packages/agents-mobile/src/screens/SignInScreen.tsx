import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebView as WebViewType } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { Screen } from '../components/Screen'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, spacing } from '../lib/theme'
import {
  buildAuthorizeUrl,
  CLOUD_AUTH_REDIRECT_PREFIX,
  parseCallbackUrl,
  type CloudAuthProvider,
} from '../lib/cloudAuth'
import { useCloudAuth } from '../lib/CloudAuthContext'
import type { Tokens } from '../lib/theme'

/**
 * Full-screen OAuth host. Same intent as the desktop's
 * `cloud-auth.openAuthorizeWindow`: navigate to
 * `dashboard.electric-sql.cloud/api/public/auth/{provider}/login`, watch
 * for the redirect back to `http://127.0.0.1:53118/callback?token=…`,
 * and capture the JWT off that URL.
 *
 * On mobile we lean on `<WebView>`'s `onShouldStartLoadWithRequest` to
 * intercept the redirect *before* the WebView actually tries to fetch
 * the loopback URL (which would 404 since nothing listens there). The
 * `state` query param round-trips a fresh UUID so a stray intercept
 * from another tab / window can't smuggle in someone else's code.
 */
export function SignInScreen({
  provider,
  onClose,
}: {
  provider: CloudAuthProvider
  onClose: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const auth = useCloudAuth()
  const webViewRef = useRef<WebViewType | null>(null)
  // `state` is a CSRF nonce baked into the OAuth URL. We hold it across
  // the WebView's lifetime so each intercepted redirect is validated
  // against the value we sent. Generated once with `useState`'s
  // initializer so a re-render doesn't reroll it.
  const [authState] = useState(() => crypto.randomUUID())
  const [authorizeUrl] = useState(() => buildAuthorizeUrl(provider, authState))
  const [loading, setLoading] = useState(true)
  // Guard against a re-entrant intercept (the redirect can fire twice
  // on Android during the cancellation race) — only complete sign-in
  // once.
  const settledRef = useRef(false)

  const handleShouldStartLoad = (req: ShouldStartLoadRequest): boolean => {
    if (!req.url.startsWith(CLOUD_AUTH_REDIRECT_PREFIX)) {
      return true
    }
    if (settledRef.current) return false
    settledRef.current = true
    const result = parseCallbackUrl(req.url, provider)
    if (!result) {
      auth.reportSignInError(`Sign-in callback was missing required fields.`)
      onClose()
      return false
    }
    if (result.state !== authState) {
      auth.reportSignInError(`Sign-in state mismatch — please try again.`)
      onClose()
      return false
    }
    void auth.completeSignIn(result).finally(() => {
      onClose()
    })
    return false
  }

  const handleCancel = (): void => {
    if (settledRef.current) return
    settledRef.current = true
    auth.cancelSignIn()
    onClose()
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          onPress={handleCancel}
          hitSlop={spacing.md}
          style={({ pressed }) => [
            styles.headerButton,
            pressed ? styles.headerButtonPressed : null,
          ]}
        >
          <Text style={styles.headerButtonText}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Sign in to Electric Cloud
        </Text>
        <View style={styles.headerButton} />
      </View>
      <View style={styles.webViewWrap}>
        <WebView
          ref={webViewRef}
          source={{ uri: authorizeUrl }}
          // Don't reuse cookies from a prior sign-in attempt — each open
          // should be a clean session so a different user can sign in.
          // The OAuth provider still keeps the user logged in across its
          // own redirects within this WebView instance.
          incognito
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onLoadEnd={() => setLoading(false)}
          // `setSupportMultipleWindows={false}` keeps GitHub's "Sign in
          // with…" sub-popups inside the same WebView instead of opening
          // a separate (untracked) window we'd never intercept.
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState={false}
          // Recent iOS WKWebView raises a `WebKitErrorDomain -1003`
          // ("server cannot be found") when our intercept cancels the
          // loopback navigation. Swallow it — the cancel is the desired
          // behavior; surfacing the error would frighten the user.
          onError={(event) => {
            const code = event.nativeEvent.code
            if (code === -1003 || code === -1004 || code === -2) return
            auth.reportSignInError(
              event.nativeEvent.description ||
                `Sign-in browser failed to load (${code}).`
            )
            onClose()
          }}
        />
        {loading && (
          <View
            style={[styles.loadingOverlay, { backgroundColor: tokens.bg }]}
            pointerEvents="none"
          >
            <ActivityIndicator color={tokens.accent11} />
          </View>
        )}
      </View>
    </Screen>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    header: {
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `space-between`,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.divider,
      backgroundColor: tokens.bg,
    },
    headerTitle: {
      flex: 1,
      textAlign: `center`,
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    headerButton: {
      minWidth: 64,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    headerButtonPressed: {
      opacity: 0.6,
    },
    headerButtonText: {
      color: tokens.accent11,
      fontSize: fontSize.base,
    },
    webViewWrap: {
      flex: 1,
      position: `relative`,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: `center`,
      justifyContent: `center`,
    },
  })
}
