import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, rowHeight, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

const SHEET_CLOSED_OFFSET = 420

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
  const [rendered, setRendered] = useState(open)
  const sheetTranslateY = useRef(
    new Animated.Value(SHEET_CLOSED_OFFSET)
  ).current
  const dragTranslateY = useRef(new Animated.Value(0)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current

  const animateOpen = (): void => {
    setRendered(true)
    dragTranslateY.setValue(0)
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const animateClosed = (afterClose?: () => void, startOffset = 0): void => {
    if (startOffset > 0) {
      sheetTranslateY.setValue(startOffset)
    }
    dragTranslateY.setValue(0)
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: SHEET_CLOSED_OFFSET,
        duration: 190,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setRendered(false)
      afterClose?.()
    })
  }

  const requestClose = (): void => {
    animateClosed(onClose)
  }

  useEffect(() => {
    if (open) {
      animateOpen()
      return
    }

    if (rendered) animateClosed()
  }, [open])

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        dragTranslateY.setValue(Math.max(0, gesture.dy))
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 48 || gesture.vy > 0.6) {
          animateClosed(onClose, Math.max(0, gesture.dy))
          return
        }

        Animated.spring(dragTranslateY, {
          toValue: 0,
          damping: 18,
          stiffness: 260,
          mass: 0.7,
          useNativeDriver: true,
        }).start()
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragTranslateY, {
          toValue: 0,
          damping: 18,
          stiffness: 260,
          mass: 0.7,
          useNativeDriver: true,
        }).start()
      },
    })
  ).current

  const sheetTransform = {
    transform: [{ translateY: Animated.add(sheetTranslateY, dragTranslateY) }],
  }

  if (!rendered) {
    return <Modal visible={false} transparent />
  }

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdropTapTarget} onPress={requestClose}>
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        />
        <Animated.View
          style={[styles.sheet, sheetTransform]}
          {...panResponder.panHandlers}
        >
          <Pressable onPress={() => {}}>
            {title && (
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            )}
            <View style={styles.body}>{children}</View>
          </Pressable>
        </Animated.View>
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
  subtitle,
  icon,
  trailing,
  active,
  onPress,
  destructive,
  disabled,
}: {
  label: string
  subtitle?: string
  icon?: ReactNode
  trailing?: ReactNode
  active?: boolean
  onPress: () => void
  destructive?: boolean
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => itemStyles(tokens), [tokens])
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            pressed && !disabled ? styles.pressed : null,
            disabled ? styles.disabled : null,
          ]}
        >
          <View style={styles.icon}>{icon}</View>
          <View style={styles.labelColumn}>
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
            {subtitle ? (
              <Text numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
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
    backdropTapTarget: {
      flex: 1,
      justifyContent: `flex-end`,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tokens.overlay,
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
      minHeight: rowHeight.lg,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    disabled: {
      opacity: 0.5,
    },
    icon: {
      width: 22,
      alignItems: `center`,
      justifyContent: `center`,
    },
    labelColumn: {
      flex: 1,
      gap: 1,
    },
    label: {
      color: tokens.text1,
      fontSize: fontSize.base,
    },
    subtitle: {
      color: tokens.text3,
      fontSize: 11,
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
