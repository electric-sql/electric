import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useMobileAppState } from '../src/lib/MobileAppState'
import { parseSessionDeepLink } from '../src/lib/sessionLinks'
import { addSavedServer, getSavedServers } from '../src/lib/savedServers'
import { getCloudServiceIdFromServerUrl } from '../src/lib/cloudAgentUrls'
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
  const targetServer = target ? target.serverUrl.replace(/\/+$/, ``) : null
  const activeServer = serverUrl ? serverUrl.replace(/\/+$/, ``) : null
  const activeMatches = targetServer !== null && targetServer === activeServer
  const isCloud =
    targetServer !== null &&
    getCloudServiceIdFromServerUrl(targetServer) !== null

  const [destination, setDestination] = useState<string | null>(null)
  const [abandoned, setAbandoned] = useState(false)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    // No usable link, or a Cloud server we can't silently switch to
    // (Cloud needs sign-in) — give up and clear the pending link.
    if (!target || (isCloud && !activeMatches)) {
      handledRef.current = true
      setPendingSessionLink(null)
      setAbandoned(true)
      return
    }
    if (activeMatches) {
      // Capture the destination BEFORE clearing pending (which clears target).
      handledRef.current = true
      setDestination(target.entityUrl)
      setPendingSessionLink(null)
      return
    }
    // Self-hosted server we can switch to: add it if missing, then activate.
    // The serverUrl change re-renders; next pass hits the activeMatches branch.
    if (
      targetServer &&
      !getSavedServers().some((s) => s.url === targetServer)
    ) {
      addSavedServer({
        id: targetServer,
        name: hostOf(targetServer),
        url: targetServer,
        source: `manual`,
      })
    }
    if (targetServer) void saveServerUrl(targetServer)
  }, [
    target,
    isCloud,
    activeMatches,
    targetServer,
    setPendingSessionLink,
    saveServerUrl,
  ])

  if (abandoned) return <Redirect href="/" />
  if (destination) {
    return (
      <Redirect
        href={{ pathname: `/session`, params: { entityUrl: destination } }}
      />
    )
  }
  return (
    <View style={styles.root}>
      <ActivityIndicator color={tokens.accent11} />
    </View>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.bg,
    },
  })
}
