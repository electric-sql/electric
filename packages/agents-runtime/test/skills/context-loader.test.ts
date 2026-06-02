import { describe, expect, it } from 'vitest'
import {
  buildSkillSlashCommands,
  createContextSkillLoader,
} from '../../src/skills/context-loader'
import type { SkillsRegistry } from '../../src/skills/types'
import type { SlashCommandDefinition } from '../../src/composer-input'

function createRegistry(): SkillsRegistry {
  return {
    catalog: new Map([
      [
        `quickstart`,
        {
          name: `quickstart`,
          description: `Guided quickstart`,
          whenToUse: `User wants a tutorial`,
          keywords: [`quickstart`],
          userInvocable: true,
          max: 1000,
          charCount: 100,
          contentHash: `hash-1`,
          source: `/skills/quickstart.md`,
        },
      ],
      [
        `init`,
        {
          name: `init`,
          description: `Scaffold a project`,
          whenToUse: `User wants a new app`,
          keywords: [`init`],
          arguments: [`project_name`, `Bad-Arg`],
          argumentHint: `[project-name]`,
          userInvocable: true,
          max: 1000,
          charCount: 100,
          contentHash: `hash-2`,
          source: `/skills/init.md`,
        },
      ],
      [
        `internal`,
        {
          name: `internal`,
          description: `Internal helper`,
          whenToUse: `Never directly`,
          keywords: [],
          userInvocable: false,
          max: 1000,
          charCount: 100,
          contentHash: `hash-3`,
          source: `/skills/internal.md`,
        },
      ],
      [
        `BadName`,
        {
          name: `BadName`,
          description: `Invalid command name`,
          whenToUse: `Never directly`,
          keywords: [],
          userInvocable: true,
          max: 1000,
          charCount: 100,
          contentHash: `hash-4`,
          source: `/skills/bad.md`,
        },
      ],
    ]),
    renderCatalog: (budget = 2_000) => `catalog:${budget}`,
    readContent: async (name) =>
      name === `quickstart`
        ? `# Quickstart\nArguments: $ARGUMENTS`
        : `# ${name}`,
  }
}

function createWake(payload: unknown) {
  return {
    type: `inbox`,
    source: `/principal/user-1`,
    message: {
      type: `composer_input`,
      payload,
      from: `/principal/user-1`,
    },
  }
}

describe(`buildSkillSlashCommands`, () => {
  it(`maps user-invocable skills to valid slash command declarations`, () => {
    expect(buildSkillSlashCommands(createRegistry())).toEqual([
      {
        name: `init`,
        description: `Scaffold a project`,
        arguments: [
          {
            name: `project_name`,
            type: `string`,
            required: false,
            description: `[project-name]`,
          },
        ],
      },
      {
        name: `quickstart`,
        description: `Guided quickstart`,
      },
    ])
  })
})

describe(`createContextSkillLoader`, () => {
  it(`refreshes slash commands and exposes tools plus catalog source`, async () => {
    const replaced: Array<{
      owner: string
      commands: Array<SlashCommandDefinition>
    }> = []
    const loader = createContextSkillLoader(createRegistry(), {
      slashCommandOwner: `test:skills`,
      catalogBudget: 123,
    })

    const loaded = await loader.load({
      wake: createWake({ source: `hello` }),
      slashCommands: {
        replaceOwned: (owner, commands) => replaced.push({ owner, commands }),
      },
      insertContext: () => undefined,
      removeContext: () => undefined,
      getContext: () => undefined,
    } as any)

    expect(loader.hasSkills).toBe(true)
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.owner).toBe(`test:skills`)
    expect(replaced[0]?.commands.map((command) => command.name)).toEqual([
      `init`,
      `quickstart`,
    ])
    expect(loaded.tools.map((tool) => tool.name)).toEqual([
      `use_skill`,
      `remove_skill`,
    ])
    const catalogContent = await loaded.sources.skills_catalog?.content()
    expect(catalogContent).toBe(`catalog:123`)
    expect(loaded.autoLoadedSkills).toEqual([])
  })

  it(`proactively loads a skill named by composer slash command`, async () => {
    const inserted: Array<{
      id: string
      entry: { name: string; attrs?: Record<string, unknown>; content: string }
    }> = []
    const loader = createContextSkillLoader(createRegistry(), {
      slashCommandOwner: `test:skills`,
    })

    const loaded = await loader.load({
      wake: createWake({
        source: `/quickstart with auth`,
        nodes: [
          {
            kind: `slash_command`,
            start: 0,
            end: 11,
            raw: `/quickstart`,
            name: `quickstart`,
          },
        ],
      }),
      slashCommands: {
        replaceOwned: () => undefined,
      },
      insertContext: (id, entry) => inserted.push({ id, entry }),
      removeContext: () => undefined,
      getContext: () => undefined,
    } as any)

    expect(inserted).toEqual([
      {
        id: `skill:quickstart`,
        entry: {
          name: `skill_instructions`,
          attrs: { skill: `quickstart`, type: `directive` },
          content: `# Quickstart\nArguments: with auth`,
        },
      },
    ])
    expect(loaded.autoLoadedSkills).toEqual([`quickstart`])
    const skillSource = await loaded.sources[`skill:quickstart`]?.content()
    expect(skillSource).toContain(`SKILL ACTIVATED: "quickstart"`)
    expect(skillSource).toContain(`# Quickstart`)
    expect(skillSource).toContain(`Arguments: with auth`)
  })

  it(`clears owned slash commands when no registry is available`, async () => {
    const replaced: Array<{
      owner: string
      commands: Array<SlashCommandDefinition>
    }> = []
    const loader = createContextSkillLoader(null, {
      slashCommandOwner: `test:skills`,
    })

    const loaded = await loader.load({
      wake: createWake({ source: `hello` }),
      slashCommands: {
        replaceOwned: (owner, commands) => replaced.push({ owner, commands }),
      },
      insertContext: () => undefined,
      removeContext: () => undefined,
      getContext: () => undefined,
    } as any)

    expect(loader.hasSkills).toBe(false)
    expect(replaced).toEqual([{ owner: `test:skills`, commands: [] }])
    expect(loaded).toEqual({ tools: [], sources: {}, autoLoadedSkills: [] })
  })
})
