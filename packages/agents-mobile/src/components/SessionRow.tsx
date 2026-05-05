import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, spacing } from '../lib/theme'
import { getEntityDisplayTitle, type ElectricEntity } from '../lib/agentsClient'
import type { Tokens } from '../lib/theme'

/**
 * One row in the home-screen sessions list.
 *
 * ChatGPT-mobile pattern: title-only, generous touch target, no
 * trailing chrome. Stopped sessions drop to 0.55 opacity so they
 * fade into the background without disappearing entirely (matches
 * the web `SidebarRow.module.css .stopped` rule).
 *
 * The previous design had `[status dot] [title] [type label]`; we
 * dropped both flanks because the kebab menu now exposes filter /
 * group-by, and the type info is implicit in the entity URL.
 */
export function SessionRow({
  entity,
  onPress,
}: {
  entity: ElectricEntity
  onPress: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const title = getEntityDisplayTitle(entity)
  const isStopped = entity.status === `stopped`

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            pressed ? styles.pressed : null,
            isStopped ? styles.stopped : null,
          ]}
        >
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    row: {
      flexDirection: `row`,
      alignItems: `center`,
      // 44pt iOS touch-target minimum, with title vertically centred.
      minHeight: 44,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radii.lg,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    stopped: {
      opacity: 0.55,
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      fontSize: fontSize.base,
      lineHeight: 20,
    },
  })
}
