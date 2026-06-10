import { useCallback, useMemo, useState } from 'react'
import {
  ActionSheetIOS,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native'
import {
  formatSlashCommandArgumentHint,
  normalizeCommandName,
  type SlashCommandRow,
} from '@electric-ax/agents-runtime/client'
import {
  buildSlashCommandInsertion,
  computeHighlightRanges,
  filterSlashCommands,
  resolveSlashTrigger,
  type ComposerInsertion,
  type Selection,
} from '../lib/slashAutocomplete'
import type { AttachmentDraft } from '../lib/attachments'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import { BottomSheet, BottomSheetItem } from './BottomSheet'
import { Icon } from './Icon'

export type SlashAutocomplete = {
  /** Whether the suggestion menu should be shown. */
  open: boolean
  /** Commands matching the active query, capped (see `filterSlashCommands`). */
  items: Array<SlashCommandRow>
  /** Wire to `TextInput.onSelectionChange` so the caret drives the trigger. */
  onSelectionChange: (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>
  ) => void
  /** Splice a chosen command into the value at the active trigger range. */
  applyCommand: (command: SlashCommandRow) => ComposerInsertion
  /** Clear caret state, e.g. after submit clears the value. */
  reset: () => void
}

/**
 * Drives native slash-command autocomplete on a plain `TextInput`: derives the
 * trigger via the shared grammar (see {@link resolveSlashTrigger}), filters the
 * list, and produces the spliced value on selection. Everything is plain React
 * state — no WebView, no caret coordinates — which is what lets the popover
 * ({@link SlashCommandMenu}) be native.
 *
 * We keep only the raw `selection` reported by `onSelectionChange`;
 * {@link resolveSlashTrigger} turns it into the active trigger, defaulting to
 * the end of the text until a caret lands so the menu still opens on the first
 * `/`. See that function for why we bounds-check the caret rather than gate on
 * the value it was reported against.
 */
export function useSlashAutocomplete(
  value: string,
  slashCommands: Array<SlashCommandRow>,
  options: { enabled?: boolean } = {}
): SlashAutocomplete {
  const enabled = options.enabled ?? true
  const [selection, setSelection] = useState<Selection | null>(null)

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void => {
      const { start, end } = event.nativeEvent.selection
      setSelection({ start, end })
    },
    []
  )

  const reset = useCallback((): void => {
    setSelection(null)
  }, [])

  const trigger = useMemo(
    () => (enabled ? resolveSlashTrigger(value, selection) : null),
    [enabled, value, selection]
  )

  const items = useMemo(
    () => (trigger ? filterSlashCommands(slashCommands, trigger.query) : []),
    [slashCommands, trigger]
  )

  const applyCommand = useCallback(
    (command: SlashCommandRow): ComposerInsertion => {
      const range = trigger ?? { from: value.length, to: value.length }
      return buildSlashCommandInsertion(value, range, command)
    },
    [trigger, value]
  )

  return {
    open: trigger != null && items.length > 0,
    items,
    onSelectionChange,
    applyCommand,
    reset,
  }
}

export type ComposerHighlightStyles = {
  base: StyleProp<TextStyle>
  command: StyleProp<TextStyle>
  arg: StyleProp<TextStyle>
}

/**
 * Render `value` as `TextInput` children with recognized command "badges"
 * (command + its declared argument words, via {@link computeHighlightRanges})
 * styled — the command and its arguments get distinct styles while sharing a
 * background so they read as one unit. EVERY segment is wrapped in a styled
 * `<Text>` because a nested child's colour only takes effect when the
 * `TextInput` itself sets no `color`, so the base text is coloured here rather
 * than on the input. Returns null for an empty value so the placeholder shows.
 */
export function renderComposerHighlights(
  value: string,
  slashCommands: Array<SlashCommandRow>,
  styles: ComposerHighlightStyles
): React.ReactNode {
  if (value.length === 0) return null
  const ranges = computeHighlightRanges(value, slashCommands)
  if (ranges.length === 0) return <Text style={styles.base}>{value}</Text>

  const parts: Array<React.ReactNode> = []
  let cursor = 0
  let key = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(
        <Text key={key++} style={styles.base}>
          {value.slice(cursor, range.start)}
        </Text>
      )
    }
    parts.push(
      <Text key={key++} style={styles.command}>
        {value.slice(range.start, range.commandEnd)}
      </Text>
    )
    if (range.end > range.commandEnd) {
      parts.push(
        <Text key={key++} style={styles.arg}>
          {value.slice(range.commandEnd, range.end)}
        </Text>
      )
    }
    cursor = range.end
  }
  if (cursor < value.length) {
    parts.push(
      <Text key={key++} style={styles.base}>
        {value.slice(cursor)}
      </Text>
    )
  }
  return parts
}

/**
 * Native suggestion popover docked above the composer input. The composer card
 * is anchored above the keyboard, so rendering this in flow just above the input
 * row places it above the keyboard with no caret math.
 */
export function SlashCommandMenu({
  items,
  onSelect,
}: {
  items: Array<SlashCommandRow>
  onSelect: (command: SlashCommandRow) => void
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  return (
    <View style={styles.menu}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {items.map((command) => {
          const name = normalizeCommandName(command.name)
          const hint = formatSlashCommandArgumentHint(command)
          return (
            <Pressable
              key={command.key ?? `${command.source}:${name}`}
              onPress={() => onSelect(command)}
              accessibilityRole="button"
              accessibilityLabel={`Insert /${name} command`}
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <Text style={styles.rowName} numberOfLines={1}>
                <Text style={styles.rowSlash}>/</Text>
                {name}
                {hint ? (
                  <Text style={styles.rowHint}>{`  ${hint}`}</Text>
                ) : null}
              </Text>
              {command.description ? (
                <Text style={styles.rowDescription} numberOfLines={1}>
                  {command.description}
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

/**
 * Composer affordance for adding image attachments. Opens a native action
 * sheet (photo library / camera); the keyboard is dismissed first so the sheet
 * and keyboard don't fight for the bottom of the screen.
 */
export function AttachButton({
  onAddFromLibrary,
  onAddFromCamera,
  disabled,
}: {
  onAddFromLibrary: () => void
  onAddFromCamera: () => void
  disabled?: boolean
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  // Android uses the bottom-sheet menu; iOS uses a native action sheet because
  // presenting the image picker over an RN `Modal` breaks it on iOS.
  const [open, setOpen] = useState(false)
  const onPress = (): void => {
    Keyboard.dismiss()
    if (Platform.OS === `ios`) {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [`Cancel`, `Photo Library`, `Take Photo`],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) onAddFromLibrary()
          else if (index === 2) onAddFromCamera()
        }
      )
      return
    }
    setOpen(true)
  }
  return (
    <>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Attach image"
        style={({ pressed }) => [
          styles.attachButton,
          pressed && !disabled ? styles.attachButtonPressed : null,
        ]}
      >
        <Icon
          name="image"
          size={20}
          color={disabled ? tokens.text4 : tokens.text2}
          strokeWidth={2}
        />
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Add image">
        <BottomSheetItem
          label="Photo Library"
          icon={<Icon name="image" size={18} color={tokens.text2} />}
          onPress={() => {
            setOpen(false)
            onAddFromLibrary()
          }}
        />
        <BottomSheetItem
          label="Take Photo"
          icon={<Icon name="camera" size={18} color={tokens.text2} />}
          onPress={() => {
            setOpen(false)
            onAddFromCamera()
          }}
        />
      </BottomSheet>
    </>
  )
}

/**
 * Horizontal strip of image-attachment thumbnails with per-item remove
 * buttons. Renders nothing when there are no drafts.
 */
export function AttachmentTray({
  drafts,
  onRemove,
}: {
  drafts: ReadonlyArray<AttachmentDraft>
  onRemove: (index: number) => void
}): React.ReactElement | null {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  if (drafts.length === 0) return null
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.tray}
    >
      {drafts.map((draft, index) => (
        <View key={`${draft.uri}:${index}`} style={styles.thumbWrap}>
          <Image source={{ uri: draft.uri }} style={styles.thumb} />
          <Pressable
            onPress={() => onRemove(index)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${draft.name}`}
            style={styles.thumbRemove}
          >
            <Icon
              name="close"
              size={12}
              color={tokens.textOnAccent}
              strokeWidth={2.6}
            />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
}

function createStyles(tokens: Tokens) {
  return StyleSheet.create({
    menu: {
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.lg,
      backgroundColor: tokens.surfaceRaised,
      overflow: `hidden`,
      shadowColor: `#000`,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: tokens.scheme === `dark` ? 0.35 : 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    scroll: {
      maxHeight: 220,
    },
    row: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: 2,
    },
    rowPressed: {
      backgroundColor: tokens.bgHover,
    },
    rowName: {
      color: tokens.text1,
      fontSize: fontSize.base,
      lineHeight: lineHeight.base,
      fontWeight: `600`,
    },
    rowSlash: {
      color: tokens.text3,
    },
    rowHint: {
      color: tokens.text3,
      fontWeight: `400`,
    },
    rowDescription: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    attachButton: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      alignItems: `center`,
      justifyContent: `center`,
    },
    attachButtonPressed: {
      backgroundColor: tokens.bgHover,
    },
    tray: {
      gap: spacing.sm,
      // Leave room for the remove (×) buttons, which protrude 6px past the
      // top-right of each thumbnail (incl. the last one when scrolled to end).
      paddingTop: 8,
      paddingBottom: 2,
      paddingHorizontal: 8,
    },
    thumbWrap: {
      width: 60,
      height: 60,
    },
    thumb: {
      width: 60,
      height: 60,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: tokens.border1,
      backgroundColor: tokens.bgSubtle,
    },
    thumbRemove: {
      position: `absolute`,
      top: -6,
      right: -6,
      width: 20,
      height: 20,
      borderRadius: radii.pill,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.accent9,
      borderWidth: 1,
      borderColor: tokens.surface,
    },
  })
}
