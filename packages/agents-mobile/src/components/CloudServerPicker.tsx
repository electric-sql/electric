import { useMemo, useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Icon } from './Icon'
import {
  cloudAgentServerUrl,
  useCloudAgentServers,
  type CloudAgentServer,
} from '../lib/cloudAgentServers'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Lists the Electric Cloud agent servers the signed-in user can see and
 * commits the connection in-place when a row is tapped. Renders nothing
 * when the user isn't signed in.
 */
export function CloudServerPicker({
  onConnect,
  disabled,
  style,
}: {
  onConnect: (url: string, server: CloudAgentServer) => Promise<void> | void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}): React.ReactElement | null {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const { status, servers, error } = useCloudAgentServers()
  const [connectingKey, setConnectingKey] = useState<string | null>(null)

  if (status === `idle`) return null

  const handlePress = async (server: CloudAgentServer): Promise<void> => {
    if (connectingKey) return
    setConnectingKey(server.id)
    try {
      await onConnect(cloudAgentServerUrl(server.id), server)
    } finally {
      setConnectingKey(null)
    }
  }

  const anyConnecting = connectingKey !== null
  const placeholder =
    status === `loading` && servers.length === 0
      ? `Loading…`
      : status === `unauthorized`
        ? `Cloud session expired — sign in again from the Account screen.`
        : status !== `loading` && servers.length === 0
          ? `No agent servers visible. Create one in the Electric Cloud dashboard, then return here.`
          : null
  const dividerWhenNotFirst = servers.length === 0 ? null : styles.rowDivider

  return (
    <View style={[styles.section, style]}>
      {servers.map((server, index) => (
        <CloudServerRow
          key={server.id}
          server={server}
          styles={styles}
          tokens={tokens}
          first={index === 0}
          connecting={connectingKey === server.id}
          disabled={disabled || (anyConnecting && connectingKey !== server.id)}
          onPress={() => {
            void handlePress(server)
          }}
        />
      ))}
      {placeholder && (
        <View style={[styles.placeholderRow, dividerWhenNotFirst]}>
          <Text style={styles.placeholderText}>{placeholder}</Text>
        </View>
      )}
      {status === `error` && error && (
        <View style={[styles.placeholderRow, dividerWhenNotFirst]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  )
}

function CloudServerRow({
  server,
  styles,
  tokens,
  first,
  connecting,
  disabled,
  onPress,
}: {
  server: CloudAgentServer
  styles: ReturnType<typeof createStyles>
  tokens: Tokens
  first: boolean
  connecting: boolean
  disabled: boolean
  onPress: () => void
}): React.ReactElement {
  const breadcrumb = [
    server.workspaceName,
    server.projectName,
    server.environmentName,
  ]
    .filter((p): p is string => Boolean(p))
    .join(` · `)

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.rowDivider,
        disabled ? styles.rowDisabled : null,
        pressed && !disabled ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.iconCircle}>
        <Icon name="server" size={16} color={tokens.text2} strokeWidth={1.75} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {server.name}
        </Text>
        {breadcrumb.length > 0 && (
          <Text numberOfLines={1} style={styles.rowMeta}>
            {breadcrumb}
          </Text>
        )}
      </View>
      <View style={styles.rowAside}>
        {connecting ? (
          <Text style={styles.connectingText}>Connecting…</Text>
        ) : (
          <Icon
            name="chevron-right"
            size={16}
            color={tokens.text3}
            strokeWidth={1.75}
          />
        )}
      </View>
    </Pressable>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    section: {
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.md,
      backgroundColor: tokens.surface,
      overflow: `hidden`,
    },
    row: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border1,
    },
    rowDisabled: {
      opacity: 0.6,
    },
    rowPressed: {
      backgroundColor: tokens.bgHover,
    },
    iconCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: tokens.bgSubtle,
      alignItems: `center`,
      justifyContent: `center`,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    rowMeta: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    rowAside: {
      alignItems: `flex-end`,
      justifyContent: `center`,
    },
    connectingText: {
      color: tokens.text3,
      fontSize: fontSize.xs,
    },
    placeholderRow: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    placeholderText: {
      color: tokens.text3,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    errorText: {
      color: tokens.red11,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
  })
}
