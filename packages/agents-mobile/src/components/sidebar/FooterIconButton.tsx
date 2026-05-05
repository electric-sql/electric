import { useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTokens } from '../../lib/ThemeProvider'
import { radii } from '../../lib/theme'
import type { Tokens } from '../../lib/theme'

/**
 * 24px ghost icon button used at the trailing edge of the sidebar
 * footer (filter / settings glyphs). Mirrors the web `IconButton
 * variant="ghost" size={1}` look-and-feel.
 */
export function FooterIconButton({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void
  accessibilityLabel: string
  children: ReactNode
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      {({ pressed }) => (
        <View style={[styles.root, pressed ? styles.pressed : null]}>
          {children}
        </View>
      )}
    </Pressable>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      width: 24,
      height: 24,
      borderRadius: radii.sm,
      alignItems: `center`,
      justifyContent: `center`,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
  })
}
