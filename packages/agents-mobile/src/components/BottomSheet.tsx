import { useMemo, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

/**
 * Lightweight bottom-sheet menu — slides up over the current screen
 * with a list of `BottomSheetItem`s. Visually mirrors the web's Menu
 * portal: tinted overlay, rounded surface raised over the content,
 * 28px row height per item with optional leading glyph + check.
 *
 * Designed for short fixed-height menus (≤ a phone screen). For
 * long lists, use a ScrollView inside `children` and add a height
 * cap via `containerStyle`.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop the press from bubbling so taps inside the sheet
            don't dismiss it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {title && (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          )}
          <View style={styles.body}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

export function BottomSheetSection({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => sectionStyles(tokens), [tokens])
  return (
    <View style={styles.section}>
      {label && <Text style={styles.label}>{label}</Text>}
      {children}
    </View>
  )
}

export function BottomSheetItem({
  label,
  icon,
  trailing,
  active,
  onPress,
  destructive,
}: {
  label: string
  icon?: ReactNode
  trailing?: ReactNode
  active?: boolean
  onPress: () => void
  destructive?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => itemStyles(tokens), [tokens])
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.row, pressed ? styles.pressed : null]}>
          <View style={styles.icon}>{icon}</View>
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              destructive ? styles.destructive : null,
              active ? styles.activeLabel : null,
            ]}
          >
            {label}
          </Text>
          <View style={styles.trailing}>
            {trailing ?? (active ? <CheckGlyph color={tokens.text1} /> : null)}
          </View>
        </View>
      )}
    </Pressable>
  )
}

export function BottomSheetSeparator(): React.ReactElement {
  const tokens = useTokens()
  return (
    <View
      style={{
        height: 1,
        backgroundColor: tokens.divider,
        marginVertical: 6,
      }}
    />
  )
}

function CheckGlyph({ color }: { color: string }): React.ReactElement {
  return (
    <Text style={{ color, fontSize: 14, lineHeight: 16, fontWeight: `600` }}>
      ✓
    </Text>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: tokens.overlay,
      justifyContent: `flex-end`,
    },
    sheet: {
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.xl,
      borderTopLeftRadius: radii.xxl,
      borderTopRightRadius: radii.xxl,
      backgroundColor: tokens.surface,
      borderTopWidth: 1,
      borderColor: tokens.border1,
      shadowColor: `#000`,
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 12,
    },
    title: {
      paddingHorizontal: spacing.md,
      paddingTop: 6,
      paddingBottom: 10,
      fontSize: fontSize.sm,
      color: tokens.text3,
      fontWeight: `500`,
      textAlign: `center`,
    },
    body: {
      gap: 2,
    },
  })
}

function sectionStyles(tokens: Tokens) {
  return StyleSheet.create({
    section: {
      marginTop: 4,
    },
    label: {
      paddingHorizontal: spacing.md,
      paddingTop: 6,
      paddingBottom: 4,
      fontSize: 11,
      fontWeight: `500`,
      color: tokens.text3,
    },
  })
}

function itemStyles(tokens: Tokens) {
  return StyleSheet.create({
    row: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      height: rowHeight.lg,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    icon: {
      width: 22,
      alignItems: `center`,
      justifyContent: `center`,
    },
    label: {
      flex: 1,
      color: tokens.text1,
      fontSize: fontSize.base,
    },
    activeLabel: {
      fontWeight: `500`,
    },
    destructive: {
      color: tokens.red11,
    },
    trailing: {
      width: 22,
      alignItems: `center`,
      justifyContent: `center`,
    },
  })
}
