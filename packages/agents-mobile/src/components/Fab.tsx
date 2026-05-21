import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii } from '../lib/theme'
import { Icon, type IconName } from './Icon'
import type { Tokens } from '../lib/theme'

/**
 * Floating action button — anchored bottom-right with a safe-area
 * inset. Matches the "New" pill in the home-screen sketch: a pill of
 * the brand accent with a leading pencil glyph.
 *
 * Use `<Fab>` for one primary action per screen (the "compose" call
 * to action). For secondary actions prefer the kebab menu.
 */
export function Fab({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName
  label?: string
  onPress: () => void
  accessibilityLabel?: string
}): React.ReactElement {
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  return (
    <View
      // The wrapper is `pointerEvents="box-none"` so taps that miss
      // the pill still hit the underlying list. The pill itself
      // receives presses normally.
      pointerEvents="box-none"
      style={[
        styles.host,
        // Lift the FAB above the home indicator on iOS / nav bar on
        // Android. 16px gives roughly Material spec spacing.
        { bottom: Math.max(insets.bottom, 12) + 16 },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label ?? `Action`}
      >
        {({ pressed }) => (
          <View style={[styles.pill, pressed ? styles.pressed : null]}>
            <Icon
              name={icon}
              size={20}
              color={tokens.textOnAccent}
              strokeWidth={2}
            />
            {label ? (
              <Text style={[styles.label, { color: tokens.textOnAccent }]}>
                {label}
              </Text>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    host: {
      position: `absolute`,
      right: 16,
    },
    pill: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 8,
      height: 48,
      paddingHorizontal: 18,
      borderRadius: radii.pill,
      backgroundColor: tokens.accent11,
      shadowColor: `#000`,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 10,
      elevation: 6,
    },
    pressed: {
      opacity: 0.85,
    },
    label: {
      fontSize: fontSize.base,
      fontWeight: `600`,
    },
  })
}
