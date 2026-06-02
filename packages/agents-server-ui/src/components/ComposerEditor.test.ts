import { describe, expect, it } from 'vitest'
import { serializeComposerInput } from './ComposerEditor'
import type { SlashCommandRow } from '@electric-ax/agents-runtime/client'

const slashCommands: Array<SlashCommandRow> = [
  {
    key: `quickstart`,
    name: `quickstart`,
    description: `Guided quickstart`,
    source: `static`,
    updated_at: `2026-01-01T00:00:00.000Z`,
  },
  {
    key: `pr-review`,
    name: `pr-review`,
    description: `Review a PR`,
    source: `static`,
    updated_at: `2026-01-01T00:00:00.000Z`,
  },
]

describe(`serializeComposerInput`, () => {
  it(`emits slash command nodes with multiline source offsets`, () => {
    const source = `please /quickstart\nthen /pr-review now`

    expect(serializeComposerInput(source, slashCommands)).toEqual({
      source,
      nodes: [
        {
          kind: `slash_command`,
          start: 7,
          end: 18,
          raw: `/quickstart`,
          name: `quickstart`,
        },
        {
          kind: `slash_command`,
          start: 24,
          end: 34,
          raw: `/pr-review`,
          name: `pr-review`,
        },
      ],
    })
  })

  it(`preserves unknown valid slash commands for handler interpretation`, () => {
    const source = `/new-command with details`

    expect(serializeComposerInput(source, slashCommands)).toEqual({
      source,
      nodes: [
        {
          kind: `slash_command`,
          start: 0,
          end: 12,
          raw: `/new-command`,
          name: `new-command`,
          unknown: true,
        },
      ],
    })
  })

  it(`does not emit invalid command-like tokens`, () => {
    expect(
      serializeComposerInput(
        `/QuickStart /bad_command /also--bad`,
        slashCommands
      )
    ).toEqual({
      source: `/QuickStart /bad_command /also--bad`,
    })
  })
})
