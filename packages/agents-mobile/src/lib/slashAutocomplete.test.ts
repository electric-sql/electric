import { describe, expect, it } from 'vitest'
import {
  buildSlashCommandInsertion,
  filterSlashCommands,
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
