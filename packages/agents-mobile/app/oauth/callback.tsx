import { useEffect, useMemo, useRef, useState } from 'react'
import * as Linking from 'expo-linking'
import { useLocalSearchParams, useRouter } from 'expo-router'
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
 * As of the fix for #4416 the deep link is also consumed at the app
 * level by `CloudAuthProvider`'s global listener — that's the path
 * that actually drives the state machine. This route exists so that:
 *
 *   1. Expo Router has a real screen to render for the redirect
 *      pathname instead of falling through to "Unmatched Route" on
 *      cold start.
 *   2. We can show the user a sensible loading / error state and
 *      navigate them somewhere useful once the singleton settles.
 *
 * We **subscribe to `cloudAuth` state** rather than processing the URL
 * ourselves, so the global listener (and `signIn`'s own callback
 * handling) remain the single source of truth. We also call
 * `handleDeepLink` defensively in case neither has had a chance to
 * fire yet (e.g. extremely fast cold start where the route mounted
 * before the provider's effect ran).
 */

const STATUS_TIMEOUT_MS = 15000

type RouteStatus =
  | { kind: `working` }
  | { kind: `signed-in` }
  | { kind: `error`; message: string }

export default function OAuthCallbackRoute(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const navigatedRef = useRef(false)
  const [status, setStatus] = useState<RouteStatus>(() =>
    deriveStatus(cloudAuth.getState())
  )

  const token = pickParam(params.token)
  const stateParam = pickParam(params.state)
  const email = pickParam(params.email)
  const expiresAt = pickParam(params.expiresAt)

  // Subscribe to the singleton so we can react to the global listener
  // / signIn() finishing the flow without re-running our own copy of
  // it.
  useEffect(() => {
    const unsubscribe = cloudAuth.subscribe((next) => {
      setStatus(deriveStatus(next))
    })
    return unsubscribe
  }, [])

  // Defensive: feed any URL we have access to into the singleton so
  // the cold-start case (route mounts with the params present before
  // either the global listener or signIn() has run) still completes.
  // `handleDeepLink` is idempotent — if another handler beat us to it
  // this is a no-op.
  useEffect(() => {
    const callbackUrl = buildCallbackUrl(token, stateParam, email, expiresAt)
    if (callbackUrl) {
      void cloudAuth.handleDeepLink(callbackUrl)
      return
    }

    // No params on this render (common on cold start before Expo
    // Router has hydrated query params). Listen for the URL directly
    // and pull the initial URL off the activity intent.
    const subscription = Linking.addEventListener(`url`, ({ url }) => {
      if (isCallbackUrl(url)) {
        void cloudAuth.handleDeepLink(url)
      }
    })
    void Linking.getInitialURL()
      .then((url) => {
        if (url && isCallbackUrl(url)) {
          void cloudAuth.handleDeepLink(url)
        }
      })
      .catch(() => {
        // Ignored — the listener (and CloudAuthProvider's own copy)
        // will still get a shot at it.
      })
    return () => subscription.remove()
  }, [email, expiresAt, stateParam, token])

  // Once the singleton resolves, send the user to a useful screen.
  // We never bail on a timer just for the URL not arriving — that's
  // what produced the earlier "back to welcome with no sign-in"
  // regression. The only timeout left covers a true wedge (something
  // crashed mid-flight) and surfaces it as an error so the user can
  // retry instead of being silently bounced.
  useEffect(() => {
    if (navigatedRef.current) return
    if (status.kind === `signed-in`) {
      navigatedRef.current = true
      router.replace(`/`)
      return
    }
    if (status.kind === `error`) {
      navigatedRef.current = true
      // Drop the user back at onboarding so the welcome screen can
      // render the error in its red banner. They can immediately
      // retry from there.
      router.replace(`/onboarding`)
      return
    }
    const timeout = setTimeout(() => {
      if (navigatedRef.current) return
      console.warn(`[agents-mobile] cloud-auth callback wedged; bailing`)
      navigatedRef.current = true
      router.replace(`/onboarding`)
    }, STATUS_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [router, status])

  const message =
    status.kind === `error`
      ? status.message
      : status.kind === `signed-in`
        ? `Signed in. Returning to the app…`
        : `Finishing sign-in…`

  return (
    <View style={styles.root}>
      {status.kind !== `error` && <ActivityIndicator color={tokens.accent11} />}
      <Text style={styles.text}>{message}</Text>
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
