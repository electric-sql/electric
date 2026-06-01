import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerHorton } from '../src/agents/horton'
import type { BuiltinModelCatalog } from '../src/model-catalog'

const modelCatalog: BuiltinModelCatalog = {
  defaultChoice: {
    provider: `anthropic`,
    id: `claude-sonnet-4-6`,
    label: `Anthropic Claude Sonnet 4.6`,
    value: `anthropic:claude-sonnet-4-6`,
    reasoning: true,
    input: [`text`, `image`],
  },
  choices: [
    {
      provider: `anthropic`,
      id: `claude-sonnet-4-6`,
      label: `Anthropic Claude Sonnet 4.6`,
      value: `anthropic:claude-sonnet-4-6`,
      reasoning: true,
      input: [`text`, `image`],
    },
    {
      provider: `openai`,
      id: `gpt-4.1`,
      label: `OpenAI GPT-4.1`,
      value: `openai:gpt-4.1`,
      reasoning: false,
      input: [`text`],
    },
  ],
}

describe(`horton model selection`, () => {
  it(`exposes available models in its creation schema`, () => {
    const registry = createEntityRegistry()
    registerHorton(registry, {
      workingDirectory: `/tmp`,
      modelCatalog,
    })

    const def = registry.get(`horton`)
    expect(def?.definition.creationSchema).toBeDefined()
    const jsonSchema = (
      def!.definition.creationSchema as {
        [`~standard`]?: { jsonSchema?: { input?: () => unknown } }
      }
    )[`~standard`]?.jsonSchema?.input?.() as {
      properties?: {
        model?: { enum?: Array<string> }
        reasoningEffort?: { enum?: Array<string>; default?: string }
      }
      $defs?: {
        electricModelInputs?: {
          properties?: Record<string, { default?: Array<string> }>
        }
      }
    }

    expect(jsonSchema.properties?.model?.enum).toEqual([
      `anthropic:claude-sonnet-4-6`,
      `openai:gpt-4.1`,
    ])
    expect(jsonSchema.properties?.reasoningEffort?.enum).toEqual([
      `auto`,
      `minimal`,
      `low`,
      `medium`,
      `high`,
    ])
    expect(jsonSchema.properties?.reasoningEffort?.default).toBe(`auto`)
    expect(
      jsonSchema.$defs?.electricModelInputs?.properties?.[
        `anthropic:claude-sonnet-4-6`
      ]?.default
    ).toEqual([`text`, `image`])
    expect(
      jsonSchema.$defs?.electricModelInputs?.properties?.[`openai:gpt-4.1`]
        ?.default
    ).toEqual([`text`])
  })

  it(`uses the selected model when running Horton`, async () => {
    const registry = createEntityRegistry()
    registerHorton(registry, {
      workingDirectory: `/tmp`,
      modelCatalog,
    })

    const def = registry.get(`horton`)
    const useAgent = vi.fn()
    const run = vi.fn(async () => {})
    const fakeCtx = {
      args: { model: `openai:gpt-4.1` },
      electricTools: [],
      events: [],
      firstWake: false,
      tags: {},
      db: { collections: { inbox: { toArray: [] } } },
      useContext: vi.fn(),
      useAgent,
      agent: { run },
    } as any

    await def!.definition.handler(fakeCtx, { type: `inbox` } as any)

    expect(useAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: `openai`,
        model: `gpt-4.1`,
      })
    )
    expect(run).toHaveBeenCalledTimes(1)
  })
})
