import { describe, expect, it } from 'vitest'
import {
  firstSlashCommand,
  getSlashCommandNodes,
  hasSlashCommand,
  unknownNodes,
  validateComposerInputPayload,
  validateSlashCommandDefinitions,
} from '../src/composer-input'

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
