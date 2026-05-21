import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { Icon, type IconName } from './Icon'
import type { Tokens } from '../lib/theme'

/**
 * 36×36 ghost icon button used in `<Header>` slots — mirrors the
 * touch-target sizing of iOS's nav-bar buttons (44pt) while keeping
 * the visible glyph at Lucide's 22px scale so it reads as part of
 * the sidebar's icon column.
 *
 * Pressed state lights up the rounded background with `--ds-bg-hover`
 * for tactile feedback. Use `tone="accent"` for primary navigation
 * affordances (e.g. the `New` pencil) and the default `text2` tone
 * for everything else.
 */
export function TopBarIconButton({
  icon,
  onPress,
  accessibilityLabel,
  tone = `text`,
}: {
  icon: IconName
  onPress: () => void
  accessibilityLabel: string
  tone?: `text` | `accent`
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const color = tone === `accent` ? tokens.accent11 : tokens.text2
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {({ pressed }) => (
        <View style={[styles.button, pressed ? styles.pressed : null]}>
          <Icon name={icon} size={22} color={color} strokeWidth={1.75} />
        </View>
      )}
    </Pressable>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    button: {
      width: 36,
      height: 36,
      alignItems: `center`,
      justifyContent: `center`,
      borderRadius: 8,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
  })
}
