import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTokens } from '../../lib/ThemeProvider'
import { fontSize, radii, rowHeight, spacing } from '../../lib/theme'
import type { Tokens } from '../../lib/theme'

export type ServerStatus = `ok` | `down` | `unset`

/**
 * Mobile equivalent of `<ServerPicker>`'s footer tile. A single-line
 * `[● status] [server name] [chevrons]` strip that fills the leading
 * slot of the sidebar footer. Tapping opens the parent's bottom-sheet
 * server menu. Mirrors `ServerPicker.module.css`.
 */
export function ServerPickerTile({
  name,
  status,
  onPress,
}: {
  name: string
  status: ServerStatus
  onPress: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const dotColor =
    status === `ok`
      ? tokens.green9
      : status === `down`
        ? tokens.red9
        : tokens.gray8
  return (
    <Pressable onPress={onPress} style={{ flex: 1, minWidth: 0 }}>
      {({ pressed }) => (
        <View style={[styles.tile, pressed ? styles.pressed : null]}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <ChevronsGlyph color={tokens.text3} />
        </View>
      )}
    </Pressable>
  )
}

function ChevronsGlyph({ color }: { color: string }): React.ReactElement {
  return (
    <Text style={{ color, fontSize: 10, lineHeight: 11, fontWeight: `600` }}>
      ⇅
    </Text>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    tile: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      flex: 1,
      minWidth: 0,
      height: rowHeight.md,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.sm,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      flexShrink: 0,
    },
    name: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      fontSize: fontSize.sm,
    },
  })
}
