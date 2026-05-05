import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import { StatusDot } from './StatusDot'
import { getEntityDisplayTitle, type ElectricEntity } from '../lib/agentsClient'

const ICON_SLOT = 22
// 3px so the row's selected/hover halo sits inside the row's 7px
// border-radius — same concentric-halo rule as the web SidebarRow.
const BASE_PADDING_LEFT = 3

/**
 * One row in the sessions list — mirrors `SidebarRow.module.css`.
 *
 * Layout (single line, 28px tall):
 *
 *   [icon-slot 22px (status dot)]  [title (truncated)]  [type label]
 *
 * Selected uses `--ds-accent-a3`, hover uses `--ds-bg-hover`, and the
 * stopped state drops opacity to 0.55 — same as the web design.
 */
export function SidebarRow({
  entity,
  selected,
  onPress,
}: {
  entity: ElectricEntity
  selected: boolean
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
            selected ? styles.selected : null,
            pressed ? styles.pressed : null,
            isStopped ? styles.stopped : null,
          ]}
        >
          <View style={styles.iconSlot}>
            <StatusDot status={entity.status} size={8} />
          </View>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text style={styles.type}>{entity.type}</Text>
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
      gap: 6,
      height: rowHeight.md,
      paddingLeft: BASE_PADDING_LEFT,
      paddingRight: 8,
      borderRadius: 7,
      backgroundColor: `transparent`,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    selected: {
      backgroundColor: tokens.accentA3,
    },
    stopped: {
      opacity: 0.55,
    },
    iconSlot: {
      width: ICON_SLOT,
      height: ICON_SLOT,
      flexShrink: 0,
      alignItems: `center`,
      justifyContent: `center`,
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      fontSize: fontSize.sm,
      lineHeight: 17,
    },
    type: {
      flexShrink: 0,
      color: tokens.text3,
      fontSize: 10,
      lineHeight: 11,
      textTransform: `lowercase`,
      marginLeft: spacing.xs,
    },
  })
}

/**
 * "New session" row — same geometry as `SidebarRow` so the pencil
 * icon centres in the same x=22 column as session status dots.
 * Mirrors the `.newSessionRow` selector in `Sidebar.module.css`.
 */
export function NewSessionRow({
  onPress,
}: {
  onPress: () => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => newSessionStyles(tokens), [tokens])
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.row, pressed ? styles.pressed : null]}>
          <View style={styles.iconSlot}>
            <PencilGlyph color={tokens.text1} />
          </View>
          <Text style={styles.label}>New session</Text>
        </View>
      )}
    </Pressable>
  )
}

function newSessionStyles(tokens: Tokens) {
  return StyleSheet.create({
    row: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 6,
      height: rowHeight.md,
      paddingLeft: BASE_PADDING_LEFT,
      paddingRight: BASE_PADDING_LEFT,
      borderRadius: 7,
      backgroundColor: `transparent`,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    iconSlot: {
      width: ICON_SLOT,
      height: ICON_SLOT,
      flexShrink: 0,
      alignItems: `center`,
      justifyContent: `center`,
    },
    label: {
      flex: 1,
      color: tokens.text1,
      fontSize: fontSize.sm,
    },
  })
}

// Inline pencil glyph (≈ Lucide SquarePen) so we don't pull in the
// full icon library on the native side.
function PencilGlyph({ color }: { color: string }): React.ReactElement {
  return (
    <Text style={{ color, fontSize: 14, lineHeight: 16, fontWeight: `500` }}>
      ✎
    </Text>
  )
}
