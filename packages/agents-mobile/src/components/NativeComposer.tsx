import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native'
import {
  detectSlashCommandTrigger,
  formatSlashCommandArgumentHint,
  normalizeCommandName,
  type SlashCommandRow,
} from '@electric-ax/agents-runtime/client'
import {
  buildSlashCommandInsertion,
  filterSlashCommands,
  type ComposerInsertion,
} from '../lib/slashAutocomplete'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

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
 * trigger via the shared {@link detectSlashCommandTrigger} grammar, filters the
 * list, and produces the spliced value on selection. Everything is plain React
 * state — no WebView, no caret coordinates — which is what lets the popover
 * ({@link SlashCommandMenu}) be native.
 *
 * The caret defaults to the end of the text so the menu opens on the first `/`
 * without waiting for `onSelectionChange` — RN delivers that a render after
 * `onChangeText`, so a selection-driven caret trails the value (and can leave
 * the menu stuck closed). A reported caret is trusted only while it still
 * matches the current value, which also enables mid-text triggers and
 * suppresses the menu during a range selection.
 */
export function useSlashAutocomplete(
  value: string,
  slashCommands: Array<SlashCommandRow>,
  options: { enabled?: boolean } = {}
): SlashAutocomplete {
  const enabled = options.enabled ?? true
  const valueRef = useRef(value)
  valueRef.current = value
  const [reported, setReported] = useState<{
    caret: number | null
    value: string
  }>({ caret: null, value: `` })

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void => {
      const { start, end } = event.nativeEvent.selection
      // A `null` caret marks a range selection — no single insertion point.
      setReported({
        caret: start === end ? start : null,
        value: valueRef.current,
      })
    },
    []
  )

  const reset = useCallback((): void => {
    setReported({ caret: null, value: `` })
  }, [])

  const fresh = reported.value === value
  const caret = fresh && reported.caret !== null ? reported.caret : value.length
  const rangeSelected = fresh && reported.caret === null

  const trigger = useMemo(
    () =>
      enabled && !rangeSelected
        ? detectSlashCommandTrigger(value, caret)
        : null,
    [enabled, rangeSelected, caret, value]
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
  })
}
