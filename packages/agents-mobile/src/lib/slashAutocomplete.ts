import {
  normalizeCommandName,
  serializeComposerInput,
  type SlashCommandRow,
  type SlashCommandTrigger,
} from '@electric-ax/agents-runtime/client'

/** Caps the visible suggestions; matches the desktop composer's slice. */
export const MAX_SLASH_SUGGESTIONS = 8

export type Selection = { start: number; end: number }

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
 * desktop badge's argument slots). Only commands present in `slashCommands` are
 * highlighted; unknown `/tokens` are left plain.
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
  for (const node of serializeComposerInput(value, slashCommands).nodes ?? []) {
    if (node.kind !== `slash_command`) continue
    const command = known.get(node.name)
    if (!command) continue

    let end = node.end
    let i = node.end
    for (let arg = 0; arg < (command.arguments?.length ?? 0); arg++) {
      while (i < value.length && (value[i] === ` ` || value[i] === `\t`)) i++
      if (i >= value.length || value[i] === `\n`) break
      while (i < value.length && !/\s/.test(value[i]!)) i++
      end = i
    }
    ranges.push({ start: node.start, commandEnd: node.end, end })
  }
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
