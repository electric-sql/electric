import { useEffect, useMemo, useRef, useState } from 'react'
import * as Linking from 'expo-linking'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import {
  cloudAuth,
  isCallbackUrl,
  type CloudAuthState,
} from '../../src/lib/cloudAuth'
import { useTokens } from '../../src/lib/ThemeProvider'
import { fontSize, lineHeight, spacing } from '../../src/lib/theme'
import type { Tokens } from '../../src/lib/theme'

/**
 * Landing route for `electric-agents://oauth/callback?...` deep links.
 *
 * The cloud-auth state machine is the single source of truth; this
 * route just renders the right thing while it's in flight and bails
 * to a real screen the moment it resolves.
 *
 * Three things drive the state machine here:
 *
 *   1. `signIn()`'s own success path (when `WebBrowser` returns the
 *      URL directly).
 *   2. The global `Linking.addEventListener` set up by
 *      `CloudAuthProvider` (warm starts where the OS hands the URL to
 *      the live JS context).
 *   3. This route's defensive `handleDeepLink` calls below (cold
 *      starts where the app was relaunched onto `/oauth/callback`
 *      before either of the other two listeners could attach).
 *
 * `cloudAuth.completeCallbackUrl` deduplicates them via
 * `completingUrl` so it doesn't matter which gets there first — at
 * most one consumes the pending request, the rest no-op.
 *
 * Navigation away from here uses `<Redirect>` (rendered during the
 * render phase) instead of `router.replace` in an effect, because
 * `useEffect`-driven navigation is too easy to race with Expo
 * Router's own intent handling: in dev mode we saw the route mount,
 * status flip to `signed-in`, the effect fire, and then nothing —
 * the route was already torn down before `router.replace` finished
 * scheduling.
 */

type RouteStatus =
  | { kind: `working` }
  | { kind: `signed-in` }
  | { kind: `error`; message: string }

export default function OAuthCallbackRoute(): React.ReactElement {
  const params = useLocalSearchParams()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  const token = pickParam(params.token)
  const stateParam = pickParam(params.state)
  const email = pickParam(params.email)
  const expiresAt = pickParam(params.expiresAt)

  const [status, setStatus] = useState<RouteStatus>(() =>
    deriveStatus(cloudAuth.getState())
  )

  useEffect(() => {
    // Sync once on mount in case the state changed between the
    // `useState` initializer and this effect attaching (very narrow
    // window but happens in practice when `signIn`'s success path
    // resolves synchronously after Expo Router navigated us here).
    setStatus(deriveStatus(cloudAuth.getState()))
    const unsubscribe = cloudAuth.subscribe((next) => {
      setStatus(deriveStatus(next))
    })
    return unsubscribe
  }, [])

  // Feed any URL we can find into the singleton. Idempotent — if
  // another handler beat us to it `handleDeepLink` is a no-op.
  const dispatchedRef = useRef(false)
  useEffect(() => {
    if (dispatchedRef.current) return
    const callbackUrl = buildCallbackUrl(token, stateParam, email, expiresAt)
    if (callbackUrl) {
      dispatchedRef.current = true
      void cloudAuth.handleDeepLink(callbackUrl)
    }
  }, [token, stateParam, email, expiresAt])

  useEffect(() => {
    // Cold-start safety net: also pull the URL off the activity
    // intent and listen for any URL events that fire while we're
    // mounted.
    void Linking.getInitialURL()
      .then((url) => {
        if (url && isCallbackUrl(url)) {
          void cloudAuth.handleDeepLink(url)
        }
      })
      .catch(() => {
        // ignored — the listener / global handler still get a shot.
      })
    const subscription = Linking.addEventListener(`url`, ({ url }) => {
      if (isCallbackUrl(url)) {
        void cloudAuth.handleDeepLink(url)
      }
    })
    return () => subscription.remove()
  }, [])

  // Render-phase navigation. `<Redirect>` is processed by Expo
  // Router's render tree directly, which sidesteps the effect-timing
  // issues we hit with `router.replace` (route would tear down before
  // the replace landed).
  if (status.kind === `signed-in`) {
    return <Redirect href="/" />
  }
  if (status.kind === `error`) {
    // Drop the user back at onboarding so the welcome screen's error
    // banner renders the message and they can immediately retry.
    return <Redirect href="/onboarding" />
  }

  return (
    <View style={styles.root}>
      <ActivityIndicator color={tokens.accent11} />
      <Text style={styles.text}>Finishing sign-in…</Text>
    </View>
  )
}

function deriveStatus(state: CloudAuthState): RouteStatus {
  if (state.status === `signed-in`) return { kind: `signed-in` }
  if (state.status === `error`) {
    return {
      kind: `error`,
      message: state.error ?? `Sign-in failed.`,
    }
  }
  return { kind: `working` }
}

function buildCallbackUrl(
  token: string | null,
  state: string | null,
  email: string | null,
  expiresAt: string | null
): string | null {
  if (!token || !state || !email || !expiresAt) return null
  const query = [
    [`token`, token],
    [`state`, state],
    [`email`, email],
    [`expiresAt`, expiresAt],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(`&`)
  return `electric-agents://oauth/callback?${query}`
}

function pickParam(value: string | Array<string> | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      gap: spacing.md,
      backgroundColor: tokens.bg,
      paddingHorizontal: spacing.xl,
    },
    text: {
      color: tokens.text2,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
      textAlign: `center`,
    },
  })
}
