import { useMemo } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

type Variant = `solid` | `soft` | `ghost`

export function PrimaryButton({
  title,
  loading,
  disabled,
  variant = `solid`,
  ...props
}: PressableProps & {
  title: string
  loading?: boolean
  variant?: Variant
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const inactive = disabled || loading
  const variantStyle =
    variant === `solid`
      ? styles.solid
      : variant === `soft`
        ? styles.soft
        : styles.ghost
  const variantText =
    variant === `solid`
      ? styles.solidText
      : variant === `soft`
        ? styles.softText
        : styles.ghostText
  const indicatorColor =
    variant === `solid` ? tokens.textOnAccent : tokens.text1

  return (
    <Pressable
      {...props}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        variantStyle,
        inactive ? styles.disabled : null,
        pressed && !inactive ? styles.pressed : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <Text style={[styles.text, variantText]}>{title}</Text>
      )}
    </Pressable>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    base: {
      minHeight: rowHeight.lg,
      alignItems: `center`,
      justifyContent: `center`,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: `transparent`,
    },
    solid: {
      backgroundColor: tokens.accent9,
    },
    soft: {
      backgroundColor: tokens.accentA3,
    },
    ghost: {
      backgroundColor: `transparent`,
    },
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.85,
    },
    text: {
      fontSize: fontSize.sm,
      fontWeight: `500`,
    },
    solidText: {
      color: tokens.textOnAccent,
    },
    softText: {
      color: tokens.accent11,
    },
    ghostText: {
      color: tokens.text1,
    },
  })
}
