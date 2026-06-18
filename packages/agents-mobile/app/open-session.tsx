import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Redirect } from 'expo-router'
import { useMobileAppState } from '../src/lib/MobileAppState'
import { parseSessionDeepLink } from '../src/lib/sessionLinks'
import { getSavedServers } from '../src/lib/savedServers'
import { getCloudServiceIdFromServerUrl } from '../src/lib/cloudAgentUrls'
import { decideOpenSession } from '../src/lib/openSessionDecision'
import { useTokens } from '../src/lib/ThemeProvider'
import type { Tokens } from '../src/lib/theme'

/**
 * Landing route for `electric-agents://open-session?server=…&entity=…`.
 *
 * Reached only once onboarding is complete and a server is configured (the
 * root navigator routes here from a `pendingSessionLink` after its gates
 * clear). Switches the active server to the link's server when needed, then
 * redirects to the session. Mirrors `app/oauth/callback.tsx`: render-phase
 * `<Redirect>` for navigation, a ref-guarded effect for state mutations.
 *
 * Like the desktop app, an untrusted link can only switch to a server the
 * user has *already added*; a link pointing at an unknown server is refused
 * rather than silently added + connected to (it could be attacker-controlled).
 */
export default function OpenSessionRoute(): React.ReactElement {
  const {
    pendingSessionLink,
    setPendingSessionLink,
    serverUrl,
    saveServerUrl,
  } = useMobileAppState()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  const target = useMemo(
    () =>
      pendingSessionLink ? parseSessionDeepLink(pendingSessionLink) : null,
    [pendingSessionLink]
  )

  const [destination, setDestination] = useState<string | null>(null)
  const [abandoned, setAbandoned] = useState(false)
  const [refusedHost, setRefusedHost] = useState<string | null>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    const decision = decideOpenSession({
      target,
      activeServerUrl: serverUrl,
      isCloudServer: (url) => getCloudServiceIdFromServerUrl(url) !== null,
      isSavedServer: (url) => getSavedServers().some((s) => s.url === url),
    })
    switch (decision.kind) {
      case `abandon`:
        handledRef.current = true
        setPendingSessionLink(null)
        setAbandoned(true)
        return
      case `route`:
        // Capture the destination BEFORE clearing pending (which clears target).
        handledRef.current = true
        setDestination(decision.entityUrl)
        setPendingSessionLink(null)
        return
      case `refuse`:
        handledRef.current = true
        setPendingSessionLink(null)
        setRefusedHost(decision.host)
        return
      case `switch`:
        // Activate the (already-saved) server. The serverUrl change re-renders;
        // the next pass yields a `route` decision and navigates to the session.
        void saveServerUrl(decision.serverUrl)
        return
    }
  }, [target, serverUrl, setPendingSessionLink, saveServerUrl])

  if (abandoned) return <Redirect href="/" />
  if (destination) {
    return (
      <Redirect
        href={{ pathname: `/session`, params: { entityUrl: destination } }}
      />
    )
  }
  if (refusedHost !== null) {
    return (
      <View style={styles.root}>
        <View style={styles.message}>
          <Text style={styles.title}>Can&apos;t open this session</Text>
          <Text style={styles.body}>
            It lives on a server you haven&apos;t added
            {refusedHost ? ` (${refusedHost})` : ``}. Add the server in the app
            first, then open the link again.
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => setAbandoned(true)}
            accessibilityRole="button"
          >
            <Text style={styles.buttonLabel}>Back to app</Text>
          </Pressable>
        </View>
      </View>
    )
  }
  return (
    <View style={styles.root}>
      <ActivityIndicator color={tokens.accent11} />
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.bg,
      padding: 24,
    },
    message: {
      alignItems: `center`,
      gap: 12,
      maxWidth: 360,
    },
    title: {
      color: tokens.text1,
      fontSize: 18,
      fontWeight: `600`,
      textAlign: `center`,
    },
    body: {
      color: tokens.text3,
      fontSize: 14,
      lineHeight: 20,
      textAlign: `center`,
    },
    button: {
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 8,
      backgroundColor: tokens.accent9,
    },
    buttonLabel: {
      color: tokens.textOnAccent,
      fontSize: 15,
      fontWeight: `600`,
    },
  })
}
