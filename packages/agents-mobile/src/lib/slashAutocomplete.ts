import {
  normalizeCommandName,
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
