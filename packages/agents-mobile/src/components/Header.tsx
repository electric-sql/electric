import { useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Mobile equivalent of the web `<MainHeader>` strip.
 *
 * 44px row, page background, **no border** — the strip shares its
 * background with the column body so the chrome reads as part of the
 * surface rather than a global frame, exactly like
 * `MainHeader.module.css`.
 *
 * Layout: `[leading]  [title (flex)]  [actions]`
 */
export function Header({
  title,
  leading,
  actions,
}: {
  title?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <View style={styles.row}>
      {leading && <View style={styles.leading}>{leading}</View>}
      <View style={styles.titleBlock}>
        {typeof title === `string` ? (
          <Text numberOfLines={1} style={styles.titleText}>
            {title}
          </Text>
        ) : (
          title
        )}
      </View>
      {actions && <View style={styles.actions}>{actions}</View>}
    </View>
  )
}

/**
 * Compact text-only back button — colour matches `--ds-text-2` for
 * neutral chrome, identical to ghost IconButton tone in the web
 * MainHeader.
 */
export function HeaderBackButton({
  onPress,
  label = `Back`,
}: {
  onPress: () => void
  label?: string
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8}>
      <Text
        style={{
          color: tokens.text2,
          fontSize: fontSize.sm,
          fontWeight: `400`,
        }}
      >
        ‹ {label}
      </Text>
    </TouchableOpacity>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    row: {
      flexShrink: 0,
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      height: rowHeight.xl,
      // 10px to mirror MainHeader.module.css padding so chrome icons
      // line up with the sidebar's icon column at x=22.
      paddingHorizontal: 10,
      backgroundColor: tokens.bg,
    },
    leading: {
      flexDirection: `row`,
      alignItems: `center`,
      flexShrink: 0,
    },
    titleBlock: {
      flex: 1,
      minWidth: 0,
    },
    titleText: {
      color: tokens.text1,
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
    actions: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 2,
      flexShrink: 0,
    },
  })
}
