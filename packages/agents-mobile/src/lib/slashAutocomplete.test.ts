import { describe, expect, it } from 'vitest'
import {
  buildSlashCommandInsertion,
  computeHighlightRanges,
  filterSlashCommands,
  resolveSlashTrigger,
} from './slashAutocomplete'
import type { SlashCommandRow } from '@electric-ax/agents-runtime/client'

const command = (name: string): SlashCommandRow => ({
  key: name,
  name,
  source: `static`,
  updated_at: `2026-01-01T00:00:00.000Z`,
})

const commands = [command(`quickstart`), command(`pr-review`), command(`plan`)]

describe(`filterSlashCommands`, () => {
  it(`matches by case-insensitive name prefix`, () => {
    expect(filterSlashCommands(commands, `p`).map((c) => c.name)).toEqual([
      `pr-review`,
      `plan`,
    ])
    expect(filterSlashCommands(commands, `PR`).map((c) => c.name)).toEqual([
      `pr-review`,
    ])
  })

  it(`returns all commands for an empty query`, () => {
    expect(filterSlashCommands(commands, ``)).toHaveLength(3)
  })

  it(`caps results at the limit`, () => {
    expect(filterSlashCommands(commands, ``, 2)).toHaveLength(2)
  })

  it(`normalises a leading slash in the command name`, () => {
    expect(
      filterSlashCommands([command(`/quickstart`)], `quick`).map((c) => c.name)
    ).toEqual([`/quickstart`])
  })
})

describe(`computeHighlightRanges`, () => {
  const initCommand: SlashCommandRow = {
    key: `init`,
    name: `init`,
    source: `static`,
    updated_at: `2026-01-01T00:00:00.000Z`,
    arguments: [{ name: `project`, type: `string`, required: true }],
  }

  it(`highlights a recognized command with no arguments`, () => {
    expect(computeHighlightRanges(`go /quickstart now`, commands)).toEqual([
      { start: 3, commandEnd: 14, end: 14 },
    ])
  })

  it(`extends the highlight over a declared argument word`, () => {
    // "/init my-project" — the command + its one arg word as a single unit,
    // with the command/arg boundary marked at commandEnd.
    const value = `/init my-project`
    expect(computeHighlightRanges(value, [initCommand])).toEqual([
      { start: 0, commandEnd: 5, end: value.length },
    ])
  })

  it(`stops after the declared number of argument words`, () => {
    // Only one declared arg, so "extra" stays outside the highlight.
    expect(computeHighlightRanges(`/init proj extra`, [initCommand])).toEqual([
      { start: 0, commandEnd: 5, end: 10 },
    ])
  })

  it(`covers just the command when no argument is typed yet`, () => {
    expect(computeHighlightRanges(`/init `, [initCommand])).toEqual([
      { start: 0, commandEnd: 5, end: 5 },
    ])
  })

  it(`ignores unknown commands`, () => {
    expect(
      computeHighlightRanges(`/not-a-command here`, [initCommand])
    ).toEqual([])
  })

  it(`never extends a badge into a following command token`, () => {
    // A command with two declared arg slots followed by another recognized
    // command: the first badge must stop before `/plan` (which gets its own
    // badge) rather than swallowing it as an argument word.
    const deploy: SlashCommandRow = {
      key: `deploy`,
      name: `deploy`,
      source: `static`,
      updated_at: `2026-01-01T00:00:00.000Z`,
      arguments: [
        { name: `target`, type: `string`, required: true },
        { name: `env`, type: `string` },
      ],
    }
    const cmds = [deploy, command(`plan`)]
    // "/deploy prod /plan" — "prod" fills arg 1, but the second arg slot must
    // not consume "/plan"; the clamp leaves it for its own badge.
    expect(computeHighlightRanges(`/deploy prod /plan`, cmds)).toEqual([
      { start: 0, commandEnd: 7, end: 12 },
      { start: 13, commandEnd: 18, end: 18 },
    ])
  })
})

describe(`resolveSlashTrigger`, () => {
  it(`detects a trigger mid-text from the reported caret`, () => {
    // The reported regression: "/qui" sits mid-line with "world" after it.
    // With the caret right after "qui" the menu must open — it must not fall
    // back to end-of-text (where the `$`-anchored grammar sees only "world").
    expect(
      resolveSlashTrigger(`hello /qui world`, { start: 10, end: 10 })
    ).toEqual({ from: 6, to: 10, query: `qui` })
  })

  it(`opens at end-of-text before any selection is reported`, () => {
    // null selection = onSelectionChange hasn't landed yet; assume the caret is
    // at the end so the menu opens the instant `/` is typed.
    expect(resolveSlashTrigger(`hello /qui`, null)).toEqual({
      from: 6,
      to: 10,
      query: `qui`,
    })
  })

  it(`suppresses the menu during a range selection`, () => {
    expect(resolveSlashTrigger(`hello /qui`, { start: 2, end: 8 })).toBeNull()
  })

  it(`falls back to end-of-text for an out-of-bounds (stale) caret`, () => {
    expect(resolveSlashTrigger(`hi`, { start: 50, end: 50 })).toBeNull()
  })

  it(`returns null when no trigger precedes the caret`, () => {
    expect(
      resolveSlashTrigger(`hello world`, { start: 11, end: 11 })
    ).toBeNull()
  })
})

describe(`buildSlashCommandInsertion`, () => {
  it(`splices the command over the trigger range with a trailing space`, () => {
    const result = buildSlashCommandInsertion(
      `go /pr`,
      { from: 3, to: 6 },
      command(`pr-review`)
    )
    expect(result.value).toBe(`go /pr-review `)
    expect(result.selection).toEqual({ start: 14, end: 14 })
  })

  it(`preserves text after the cursor`, () => {
    const result = buildSlashCommandInsertion(
      `/qu rest`,
      { from: 0, to: 3 },
      command(`quickstart`)
    )
    expect(result.value).toBe(`/quickstart  rest`)
    expect(result.selection).toEqual({ start: 12, end: 12 })
  })
})
