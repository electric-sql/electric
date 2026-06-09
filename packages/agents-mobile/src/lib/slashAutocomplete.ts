import {
  detectSlashCommandTrigger,
  normalizeCommandName,
  serializeComposerInput,
  type SlashCommandRow,
  type SlashCommandTrigger,
} from '@electric-ax/agents-runtime/client'

/** Caps the visible suggestions; matches the desktop composer's slice. */
export const MAX_SLASH_SUGGESTIONS = 8

export type Selection = { start: number; end: number }

/**
 * Resolve the active slash-command trigger from the current `value` and the
 * `selection` last reported by `TextInput.onSelectionChange` (`null` before any
 * is reported). The reported caret is used whenever it indexes into the current
 * value — which is what enables triggers in the *middle* of existing text —
 * otherwise the caret is assumed to be at the end, so the menu still opens the
 * instant `/` is typed, before RN delivers the trailing selection event a
 * render later. A range selection (`start !== end`) has no single insertion
 * point and suppresses the menu.
 *
 * Deliberately does NOT gate on the value the selection was reported against:
 * RN updates `value` (`onChangeText`) a render before the matching selection
 * event, so any "does this caret still match the value" check is stale on the
 * render the value changes and wedges the menu shut for mid-text edits. Bounds-
 * checking the caret against the live value is enough and self-corrects.
 */
export function resolveSlashTrigger(
  value: string,
  selection: Selection | null
): SlashCommandTrigger | null {
  if (selection && selection.start !== selection.end) return null
  const caret =
    selection && selection.start >= 0 && selection.start <= value.length
      ? selection.start
      : value.length
  return detectSlashCommandTrigger(value, caret)
}

/** The value/caret to apply after inserting a chosen command. */
export type ComposerInsertion = {
  value: string
  selection: Selection
}

/**
 * Commands whose name starts with the (case-insensitive) query, capped. Mirrors
 * the desktop composer's prefix filter.
 */
export function filterSlashCommands(
  commands: Array<SlashCommandRow>,
  query: string,
  limit: number = MAX_SLASH_SUGGESTIONS
): Array<SlashCommandRow> {
  const normalizedQuery = query.toLowerCase()
  return commands
    .filter((command) =>
      normalizeCommandName(command.name)
        .toLowerCase()
        .startsWith(normalizedQuery)
    )
    .slice(0, limit)
}

/**
 * A command "badge" range: the `/command` token spans `[start, commandEnd)` and
 * its argument words span `[commandEnd, end)`, so the two can be styled
 * distinctly while reading as one unit.
 */
export type HighlightRange = { start: number; commandEnd: number; end: number }

/**
 * Source ranges to visually highlight as command "badges": each recognized
 * command token, extended over up to its declared number of argument words on
 * the same line (so `/init my-project` highlights as one unit, mirroring the
 * desktop badge's argument slots) but never into a following command token.
 * Only commands present in `slashCommands` are highlighted; unknown `/tokens`
 * are left plain.
 */
export function computeHighlightRanges(
  value: string,
  slashCommands: Array<SlashCommandRow>
): Array<HighlightRange> {
  const known = new Map(
    slashCommands.map((command) => [
      normalizeCommandName(command.name),
      command,
    ])
  )
  const ranges: Array<HighlightRange> = []
  const nodes = serializeComposerInput(value, slashCommands).nodes ?? []
  nodes.forEach((node, n) => {
    if (node.kind !== `slash_command`) return
    const command = known.get(node.name)
    if (!command) return

    // Never extend the badge into the next recognized command token: a
    // following `/command` is its own badge, not an argument of this one.
    const limit = nodes[n + 1]?.start ?? value.length

    let end = node.end
    let i = node.end
    for (let arg = 0; arg < (command.arguments?.length ?? 0); arg++) {
      while (i < limit && (value[i] === ` ` || value[i] === `\t`)) i++
      if (i >= limit || value[i] === `\n`) break
      while (i < limit && !/\s/.test(value[i]!)) i++
      end = i
    }
    ranges.push({ start: node.start, commandEnd: node.end, end })
  })
  return ranges
}

/**
 * Splice a chosen command into `value` over the active trigger `range`, with a
 * trailing space so the caret lands past the token for inline arguments/prose.
 */
export function buildSlashCommandInsertion(
  value: string,
  range: Pick<SlashCommandTrigger, `from` | `to`>,
  command: SlashCommandRow
): ComposerInsertion {
  const insert = `/${normalizeCommandName(command.name)} `
  const nextValue = value.slice(0, range.from) + insert + value.slice(range.to)
  const caret = range.from + insert.length
  return { value: nextValue, selection: { start: caret, end: caret } }
}
