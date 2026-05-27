import { useEffect, useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import {
  cloudAgentServerUrl,
  useCloudAgentServers,
  type CloudAgentServer,
} from '../lib/cloudAgentServers'
import { debugCloudAuth } from '../lib/cloudAuth'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Lists the Electric Cloud agent servers the signed-in user can see.
 * Subscribes to the four admin-API shapes via `useCloudAgentServers`
 * and renders each as a tappable card; tapping derives the agent-server
 * URL (host swap + `?service=`) and calls `onPick` so the parent screen
 * can drop it into its input / save flow.
 *
 * Renders nothing when the user isn't signed in to Cloud — the manual
 * URL entry on the parent screen remains the entry point in that case.
 */
export function CloudServerPicker({
  onPick,
  disabled,
}: {
  onPick: (url: string) => void
  disabled?: boolean
}): React.ReactElement | null {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { status, servers, error } = useCloudAgentServers()

  useEffect(() => {
    debugCloudAuth(`cloudServerPicker:renderState`, {
      status,
      error,
      serverIds: servers.map((server) => server.id),
      serverNames: servers.map((server) => server.name),
    })
  }, [status, error, servers])

  if (status === `idle`) return null

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Your Electric Cloud servers</Text>
      {status === `loading` && servers.length === 0 && (
        <Text style={styles.muted}>Loading…</Text>
      )}
      {status === `unauthorized` && (
        <Text style={styles.muted}>
          Cloud session expired — sign in again from the Account screen.
        </Text>
      )}
      {status === `error` && error && (
        <Text style={styles.errorText}>{error}</Text>
      )}
      {status !== `unauthorized` &&
        servers.length === 0 &&
        status !== `loading` && (
          <Text style={styles.muted}>
            No agent servers visible. Create one in the Electric Cloud
            dashboard, then return here.
          </Text>
        )}
      <View style={styles.list}>
        {servers.map((server) => (
          <CloudServerCard
            key={server.id}
            server={server}
            tokens={tokens}
            disabled={disabled}
            onPress={() => onPick(cloudAgentServerUrl(server.id))}
          />
        ))}
      </View>
    </View>
  )
}

function CloudServerCard({
  server,
  tokens,
  disabled,
  onPress,
}: {
  server: CloudAgentServer
  tokens: Tokens
  disabled?: boolean
  onPress: () => void
}): React.ReactElement {
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const breadcrumb = [
    server.workspaceName,
    server.projectName,
    server.environmentName,
  ]
    .filter((p): p is string => Boolean(p))
    .join(` · `)
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.card, disabled ? styles.cardDisabled : null]}
    >
      <Text style={styles.cardName}>{server.name}</Text>
      {breadcrumb.length > 0 && (
        <Text numberOfLines={1} style={styles.cardBreadcrumb}>
          {breadcrumb}
        </Text>
      )}
    </TouchableOpacity>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.xs,
    },
    label: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      fontWeight: `500`,
      letterSpacing: 0.6,
      textTransform: `uppercase`,
    },
    list: {
      gap: spacing.xs,
    },
    muted: {
      color: tokens.text3,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    errorText: {
      color: tokens.red11,
      fontSize: fontSize.sm,
    },
    card: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      padding: spacing.md,
    },
    cardDisabled: {
      opacity: 0.5,
    },
    cardName: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    cardBreadcrumb: {
      marginTop: spacing.xs,
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
  })
}
