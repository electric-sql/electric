import { describe, expect, it } from 'vitest'
import {
  detectSlashCommandTrigger,
  firstSlashCommand,
  formatSlashCommandArgumentHint,
  getSlashCommandNodes,
  hasSlashCommand,
  serializeComposerInput,
  unknownNodes,
  validateComposerInputPayload,
  validateSlashCommandDefinitions,
} from '../src/composer-input'
import type { SlashCommandRow } from '../src/composer-input'

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
    arguments: [
      {
        name: `number`,
        type: `number`,
        required: true,
        description: `Pull request number`,
      },
      {
        name: `include_tests`,
        type: `boolean`,
        required: false,
      },
    ],
    source: `static`,
    updated_at: `2026-01-01T00:00:00.000Z`,
  },
]

describe(`composer input validation`, () => {
  it(`accepts flat ordered structured nodes`, () => {
    const payload = {
      source: `/pr-review 123 in /worktree see @Branch`,
      nodes: [
        {
          kind: `slash_command`,
          start: 0,
          end: 10,
          raw: `/pr-review`,
          name: `pr-review`,
        },
        {
          kind: `slash_command`,
          start: 18,
          end: 27,
          raw: `/worktree`,
          name: `worktree`,
        },
        {
          kind: `branch`,
          start: 32,
          end: 39,
          raw: `@Branch`,
          name: `Branch`,
        },
      ],
    }

    expect(validateComposerInputPayload(payload)).toBeNull()
    expect(getSlashCommandNodes(payload)).toHaveLength(2)
    expect(firstSlashCommand(payload)?.name).toBe(`pr-review`)
    expect(hasSlashCommand(payload, `worktree`)).toBe(true)
  })

  it(`accepts unknown node kinds when base spans are valid`, () => {
    const payload = {
      source: `see #123`,
      nodes: [
        {
          kind: `issue`,
          start: 4,
          end: 8,
          raw: `#123`,
          number: 123,
        },
      ],
    }

    expect(validateComposerInputPayload(payload)).toBeNull()
    expect(unknownNodes(payload)).toHaveLength(1)
  })

  it(`validates spans against JavaScript string offsets`, () => {
    const payload = {
      source: `/quickstart`,
      nodes: [
        {
          kind: `slash_command`,
          start: 0,
          end: 11,
          raw: `/quick`,
          name: `quickstart`,
        },
      ],
    }

    expect(validateComposerInputPayload(payload)).toMatchObject({
      details: [
        {
          path: `/nodes/0/raw`,
          message: `must equal source.slice(start, end)`,
        },
      ],
    })
  })

  it(`rejects overlapping nodes and invalid slash command names`, () => {
    const payload = {
      source: `/QuickStart /worktree`,
      nodes: [
        {
          kind: `slash_command`,
          start: 0,
          end: 11,
          raw: `/QuickStart`,
          name: `QuickStart`,
        },
        {
          kind: `slash_command`,
          start: 10,
          end: 20,
          raw: ` /worktree`,
          name: `worktree`,
        },
      ],
    }

    expect(validateComposerInputPayload(payload)).toMatchObject({
      details: expect.arrayContaining([
        {
          path: `/nodes/0/name`,
          message: `must be a lowercase kebab-case command name`,
        },
        {
          path: `/nodes/1/start`,
          message: `must not overlap the previous node`,
        },
      ]),
    })
  })

  it(`supports multiline source spans`, () => {
    const payload = {
      source: `/search postgres\nsee @Branch`,
      nodes: [
        {
          kind: `slash_command`,
          start: 0,
          end: 7,
          raw: `/search`,
          name: `search`,
        },
        {
          kind: `branch`,
          start: 21,
          end: 28,
          raw: `@Branch`,
          name: `Branch`,
        },
      ],
    }

    expect(validateComposerInputPayload(payload)).toBeNull()
  })
})

describe(`slash command definition validation`, () => {
  it(`accepts command discovery metadata`, () => {
    expect(
      validateSlashCommandDefinitions([
        {
          name: `pr-review`,
          description: `Review a pull request`,
          arguments: [
            {
              name: `number`,
              type: `number`,
              required: true,
              description: `Pull request number`,
            },
          ],
        },
      ])
    ).toBeNull()
  })

  it(`rejects duplicate and non-normalized command names`, () => {
    expect(
      validateSlashCommandDefinitions([
        { name: `QuickStart` },
        { name: `QuickStart` },
      ])
    ).toMatchObject({
      details: expect.arrayContaining([
        {
          path: `/slash_commands/0/name`,
          message: `must be a lowercase kebab-case command name`,
        },
        {
          path: `/slash_commands/1/name`,
          message: `must be a lowercase kebab-case command name`,
        },
      ]),
    })
  })
})

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
    // Pins the v1 grammar boundary: uppercase, underscores, and double-hyphens
    // are not slash commands. Mobile (regex-only) and the desktop fallback must
    // agree on exactly this set, so a typed `/PR-review` is plain text on both.
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

describe(`formatSlashCommandArgumentHint`, () => {
  it(`formats required and optional arguments as menu hint text`, () => {
    expect(formatSlashCommandArgumentHint(slashCommands[1]!)).toBe(
      `number: number [include_tests]: boolean`
    )
  })

  it(`returns an empty hint for commands without arguments`, () => {
    expect(formatSlashCommandArgumentHint(slashCommands[0]!)).toBe(``)
  })
})

describe(`detectSlashCommandTrigger`, () => {
  it(`detects an in-progress trigger at the cursor`, () => {
    const text = `please /pr-rev`
    expect(detectSlashCommandTrigger(text, text.length)).toEqual({
      from: 7,
      to: 14,
      query: `pr-rev`,
    })
  })

  it(`opens on a bare slash`, () => {
    expect(detectSlashCommandTrigger(`/`, 1)).toEqual({
      from: 0,
      to: 1,
      query: ``,
    })
  })

  it(`only considers the text before the cursor`, () => {
    const text = `/quickstart and more`
    // Cursor parked after the completed command + a space: no active trigger.
    expect(detectSlashCommandTrigger(text, 12)).toBeNull()
  })

  it(`does not trigger mid-word`, () => {
    expect(detectSlashCommandTrigger(`path/to`, 7)).toBeNull()
  })
})
