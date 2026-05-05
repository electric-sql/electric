import { useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, rowHeight, spacing } from '../lib/theme'
import { Icon } from './Icon'
import type { Tokens } from '../lib/theme'

/**
 * Mobile equivalent of an iOS-style nav bar / web `<MainHeader>`.
 *
 * 44px row, page background, **no border**. Two layouts:
 *
 *   - `align="leading"` (default) — `[leading] [title (flex)] [actions]`,
 *     used on the home screen where the title is brand-aligned.
 *   - `align="center"` — `[leading abs] [title centred] [actions abs]`,
 *     used on the session/chat screen for the standard iOS pattern.
 *
 * Centred mode positions the leading/actions clusters absolutely so
 * the title stays optically centred regardless of how many icons sit
 * on either side. This matches `UINavigationBar` and ChatGPT/Claude
 * iOS apps.
 */
export function Header({
  title,
  leading,
  actions,
  align = `leading`,
}: {
  title?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  align?: `leading` | `center`
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  if (align === `center`) {
    return (
      <View style={styles.row}>
        {leading && (
          <View style={[styles.absolute, styles.absoluteLeading]}>
            {leading}
          </View>
        )}
        <View style={styles.centerTitleBlock} pointerEvents="none">
          {typeof title === `string` ? (
            <Text numberOfLines={1} style={styles.titleText}>
              {title}
            </Text>
          ) : (
            title
          )}
        </View>
        {actions && (
          <View style={[styles.absolute, styles.absoluteActions]}>
            {actions}
          </View>
        )}
      </View>
    )
  }

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
 * iOS-style back button — chevron glyph + accent tint, mirroring the
 * standard `UINavigationBar` back affordance. Defaults to icon-only;
 * pass `label` to render an inline text label next to the chevron.
 */
export function HeaderBackButton({
  onPress,
  label,
  accessibilityLabel = `Back`,
}: {
  onPress: () => void
  label?: string
  accessibilityLabel?: string
}): React.ReactElement {
  const tokens = useTokens()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: `row`,
        alignItems: `center`,
        gap: 2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="back" size={26} color={tokens.accent11} strokeWidth={2.25} />
      {label ? (
        <Text
          style={{
            color: tokens.accent11,
            fontSize: fontSize.base,
            fontWeight: `400`,
          }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
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
      paddingHorizontal: 8,
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
      paddingHorizontal: 4,
    },
    titleText: {
      color: tokens.text1,
      fontSize: fontSize.lg,
      fontWeight: `600`,
    },
    actions: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 0,
      flexShrink: 0,
    },
    centerTitleBlock: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      // Reserve space on either side for the absolutely-positioned
      // leading / actions clusters so a long title truncates instead
      // of overlapping the icons.
      paddingHorizontal: 56,
    },
    absolute: {
      position: `absolute`,
      top: 0,
      bottom: 0,
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `center`,
      paddingHorizontal: 8,
    },
    absoluteLeading: {
      left: 0,
    },
    absoluteActions: {
      right: 0,
    },
  })
}
