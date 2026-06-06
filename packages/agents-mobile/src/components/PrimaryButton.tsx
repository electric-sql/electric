import { useMemo } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from 'react-native'
import { Icon, type IconName } from './Icon'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

type Variant = `solid` | `soft` | `ghost`

export function PrimaryButton({
  title,
  loading,
  disabled,
  variant = `solid`,
  leadingIcon,
  trailingIcon,
  ...props
}: PressableProps & {
  title: string
  loading?: boolean
  variant?: Variant
  leadingIcon?: IconName
  trailingIcon?: IconName
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
  const foreground =
    variant === `solid`
      ? tokens.textOnAccent
      : variant === `soft`
        ? tokens.accent11
        : tokens.text1

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
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          {leadingIcon && (
            <Icon
              name={leadingIcon}
              size={16}
              color={foreground}
              strokeWidth={1.75}
            />
          )}
          <Text style={[styles.text, variantText]}>{title}</Text>
          {trailingIcon && (
            <Icon
              name={trailingIcon}
              size={16}
              color={foreground}
              strokeWidth={1.75}
            />
          )}
        </View>
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
    content: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
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
