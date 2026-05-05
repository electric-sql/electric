import { useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { radii } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * 24px square ghost icon button — mirrors the web `IconButton size={1}`
 * used in `MainHeader` / `EntityHeader`. When `active`, paints the
 * neutral `--ds-gray-a4` background that the web uses for the
 * "view-toggled-on" affordance.
 */
export function IconToggle({
  active,
  onPress,
  accessibilityLabel,
  children,
}: {
  active?: boolean
  onPress: () => void
  accessibilityLabel?: string
  children: ReactNode
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.root,
            active ? styles.active : null,
            pressed ? styles.pressed : null,
          ]}
        >
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
    active: {
      backgroundColor: tokens.bgHover,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
  })
}
