import { useEffect, useMemo, useRef } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, rowHeight, spacing } from '../lib/theme'
import { Icon } from './Icon'
import type { Tokens } from '../lib/theme'

/**
 * Inline search bar that replaces the home-screen `<Header>` while
 * search mode is active. Mirrors the iOS Mail / ChatGPT pattern:
 *
 *   [search-icon] [TextInput (flex)] [Cancel]
 *
 * The text input auto-focuses when mounted and the Cancel button
 * lifts the user back to the regular header. Clearing the field
 * happens on the consumer side via the `onChangeText` callback.
 */
export function SearchBar({
  value,
  onChangeText,
  onCancel,
  autoFocus = true,
  placeholder = `Search`,
}: {
  value: string
  onChangeText: (next: string) => void
  onCancel: () => void
  autoFocus?: boolean
  placeholder?: string
} & Pick<TextInputProps, `placeholder`>): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    if (autoFocus) {
      // requestAnimationFrame avoids the keyboard fighting with the
      // header transition on slower devices.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [autoFocus])

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Icon name="search" size={18} color={tokens.text3} strokeWidth={2} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={tokens.text3}
          // iOS keyboard "Search" return key + dismiss-on-blur for
          // ergonomics on small phones.
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={styles.input}
        />
      </View>
      <Pressable onPress={onCancel} hitSlop={6}>
        {({ pressed }) => (
          <Text
            style={[
              styles.cancel,
              { color: tokens.accent11 },
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            Cancel
          </Text>
        )}
      </Pressable>
    </View>
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
      paddingHorizontal: spacing.md,
      backgroundColor: tokens.bg,
    },
    field: {
      flex: 1,
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.xs,
      height: 36,
      paddingHorizontal: 10,
      borderRadius: radii.lg,
      backgroundColor: tokens.surface,
      borderWidth: 1,
      borderColor: tokens.border1,
    },
    input: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      // 16px keeps iOS Safari from auto-zooming on focus, which we
      // mirror in the embed; same trade-off applies to native inputs
      // when running on iOS WebViews adjacent to the field.
      fontSize: fontSize.lg,
      paddingVertical: 0,
    },
    cancel: {
      fontSize: fontSize.base,
      fontWeight: `500`,
    },
  })
}
