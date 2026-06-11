import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBuiltinModelCatalog,
  resolveBuiltinModelConfig,
  resolveBuiltinModelContextWindow,
  resolveBuiltinModelSourceBudget,
} from '../src/model-catalog'

const originalEnv = { ...process.env }

describe(`model catalog`, () => {
  beforeEach(() => {
    vi.stubGlobal(
      `fetch`,
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: `gpt-4.1` }, { id: `gpt-5` }, { id: `not-in-runtime` }],
        }),
      }))
    )
    process.env = { ...originalEnv }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.MOONSHOT_API_KEY
    process.env.OPENAI_API_KEY = `test-openai-key`
    process.env.CODEX_AUTH_PATH = `/nonexistent/auth.json`
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it(`lists runtime-supported models available to configured providers`, async () => {
    const catalog = await createBuiltinModelCatalog()

    expect(catalog).not.toBeNull()
    expect(catalog!.choices.map((choice) => choice.value)).toContain(
      `openai:gpt-4.1`
    )
    expect(catalog!.choices.map((choice) => choice.value)).not.toContain(
      `openai:not-in-runtime`
    )
  })

  it(`resolves selected model values into agent config`, async () => {
    const catalog = await createBuiltinModelCatalog()

    expect(
      resolveBuiltinModelConfig(catalog!, { model: `openai:gpt-4.1` })
    ).toEqual({
      provider: `openai`,
      model: `gpt-4.1`,
    })
  })

  it(`resolves model context windows and source budgets from known model metadata`, () => {
    expect(
      resolveBuiltinModelContextWindow({
        provider: `openai`,
        model: `gpt-4.1`,
      })
    ).toBe(1_047_576)
    expect(
      resolveBuiltinModelSourceBudget({
        provider: `anthropic`,
        model: `claude-sonnet-4-6`,
      })
    ).toBe(1_000_000)
    expect(
      resolveBuiltinModelSourceBudget({
        provider: `moonshot`,
        model: `moonshot-v1-8k`,
      })
    ).toBe(8_192)
  })

  it(`falls back to the previous source budget for unknown model metadata`, () => {
    expect(
      resolveBuiltinModelSourceBudget({
        provider: `openai`,
        model: `unknown-model`,
      })
    ).toBe(100_000)
  })

  it(`filters choices to enabled model values`, async () => {
    const catalog = await createBuiltinModelCatalog({
      enabledModelValues: [`openai:gpt-5`],
    })

    expect(catalog).not.toBeNull()
    expect(catalog!.choices.map((choice) => choice.value)).toEqual([
      `openai:gpt-5`,
    ])
    expect(catalog!.defaultChoice.value).toBe(`openai:gpt-5`)
  })

  it(`falls back to available choices when enabled model values are stale`, async () => {
    const catalog = await createBuiltinModelCatalog({
      enabledModelValues: [`deepseek:missing`],
    })

    expect(catalog).not.toBeNull()
    expect(catalog!.choices.map((choice) => choice.value)).toContain(
      `openai:gpt-4.1`
    )
  })

  it(`sets a valid reasoning effort for OpenAI reasoning models`, async () => {
    const catalog = await createBuiltinModelCatalog()
    const config = resolveBuiltinModelConfig(catalog!, {
      model: `openai:gpt-5`,
    })

    expect(config).toMatchObject({
      provider: `openai`,
      model: `gpt-5`,
    })
    expect(config.onPayload).toBeTypeOf(`function`)

    const payload = config.onPayload!(
      { reasoning: { effort: `none` } },
      {} as any
    )

    expect(payload).toEqual({
      store: true,
      reasoning: { effort: `minimal` },
    })
  })

  it(`uses explicit reasoning effort for OpenAI reasoning models`, async () => {
    const catalog = await createBuiltinModelCatalog()
    const config = resolveBuiltinModelConfig(catalog!, {
      model: `openai:gpt-5`,
      reasoningEffort: `high`,
    })

    expect(config.reasoningEffort).toBe(`high`)

    const payload = config.onPayload!(
      { reasoning: { effort: `none` } },
      {} as any
    )

    expect(payload).toEqual({
      store: true,
      reasoning: { effort: `high` },
    })
  })

  it(`enables Anthropic extended thinking with a minimal budget when reasoningEffort is auto`, async () => {
    process.env.ANTHROPIC_API_KEY = `test-anthropic-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`api.anthropic.com`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: `claude-sonnet-4-6` }] }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()
    const config = resolveBuiltinModelConfig(catalog!, {
      model: `anthropic:claude-sonnet-4-6`,
    })

    expect(config.onPayload).toBeTypeOf(`function`)
    expect(config.onPayload!({}, {} as any)).toEqual({
      thinking: { type: `enabled`, budget_tokens: 1024 },
    })
  })

  it(`overrides a pre-existing thinking.type=disabled in the Anthropic payload`, async () => {
    process.env.ANTHROPIC_API_KEY = `test-anthropic-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`api.anthropic.com`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: `claude-sonnet-4-6` }] }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()
    const config = resolveBuiltinModelConfig(catalog!, {
      model: `anthropic:claude-sonnet-4-6`,
    })

    expect(
      config.onPayload!({ thinking: { type: `disabled` } }, {} as any)
    ).toEqual({
      thinking: { type: `enabled`, budget_tokens: 1024 },
    })
  })

  it(`scales Anthropic thinking budget with explicit reasoningEffort`, async () => {
    process.env.ANTHROPIC_API_KEY = `test-anthropic-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`api.anthropic.com`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: `claude-sonnet-4-6` }] }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()
    const config = resolveBuiltinModelConfig(catalog!, {
      model: `anthropic:claude-sonnet-4-6`,
      reasoningEffort: `high`,
    })

    expect(config.onPayload!({}, {} as any)).toEqual({
      thinking: { type: `enabled`, budget_tokens: 24576 },
    })
  })

  it(`forces store true only for OpenAI reasoning model payloads`, async () => {
    const openAiCatalog = await createBuiltinModelCatalog()
    const openAiConfig = resolveBuiltinModelConfig(openAiCatalog!, {
      model: `openai:gpt-5`,
    })

    expect(
      openAiConfig.onPayload!(
        { store: false, reasoning: { effort: `none` } },
        {} as any
      )
    ).toEqual({
      store: true,
      reasoning: { effort: `minimal` },
    })

    delete process.env.OPENAI_API_KEY
    process.env.DEEPSEEK_API_KEY = `test-deepseek-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`deepseek.com`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: `deepseek-v4-flash` }] }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const deepseekCatalog = await createBuiltinModelCatalog()
    const deepseekConfig = resolveBuiltinModelConfig(deepseekCatalog!, {
      model: `deepseek:deepseek-v4-flash`,
    })

    expect(deepseekConfig.onPayload).toBeUndefined()
  })

  it(`does not expose providers whose keys are rejected`, async () => {
    vi.stubGlobal(
      `fetch`,
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      }))
    )

    const catalog = await createBuiltinModelCatalog()

    expect(catalog).toBeNull()
  })

  it(`lists DeepSeek models when DEEPSEEK_API_KEY is set`, async () => {
    delete process.env.OPENAI_API_KEY
    process.env.DEEPSEEK_API_KEY = `test-deepseek-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`deepseek.com`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: `deepseek-v4-flash` }, { id: `deepseek-v4-pro` }],
            }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()

    expect(catalog).not.toBeNull()
    expect(catalog!.choices.map((c) => c.provider)).toContain(`deepseek`)
    expect(catalog!.choices.map((c) => c.value)).toContain(
      `deepseek:deepseek-v4-flash`
    )
    expect(catalog!.choices.map((c) => c.value)).toContain(
      `deepseek:deepseek-v4-pro`
    )
  })

  it(`resolves deepseek model config correctly`, async () => {
    delete process.env.OPENAI_API_KEY
    process.env.DEEPSEEK_API_KEY = `test-deepseek-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`deepseek.com`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: `deepseek-v4-flash` }, { id: `deepseek-v4-pro` }],
            }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()

    expect(
      resolveBuiltinModelConfig(catalog!, {
        model: `deepseek:deepseek-v4-flash`,
      })
    ).toEqual({
      provider: `deepseek`,
      model: `deepseek-v4-flash`,
    })
  })

  it(`lists Kimi / Moonshot models when MOONSHOT_API_KEY is set`, async () => {
    delete process.env.OPENAI_API_KEY
    process.env.MOONSHOT_API_KEY = `test-moonshot-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`api.moonshot.ai`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: `kimi-k2.6` }, { id: `moonshot-v1-8k` }],
            }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()

    expect(catalog).not.toBeNull()
    expect(catalog!.choices.map((c) => c.provider)).toContain(`moonshot`)
    expect(catalog!.choices.map((c) => c.value)).toContain(`moonshot:kimi-k2.6`)
    expect(catalog!.choices.map((c) => c.value)).toContain(
      `moonshot:moonshot-v1-8k`
    )
  })

  it(`resolves Kimi / Moonshot model config with a runtime API key hook`, async () => {
    delete process.env.OPENAI_API_KEY
    process.env.MOONSHOT_API_KEY = `test-moonshot-key`
    vi.stubGlobal(
      `fetch`,
      vi.fn(async (url: string) => {
        if (String(url).includes(`api.moonshot.ai`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: `kimi-k2.6` }] }),
          }
        }
        return { ok: false, status: 401, json: async () => ({}) }
      })
    )

    const catalog = await createBuiltinModelCatalog()
    const config = resolveBuiltinModelConfig(catalog!, {
      model: `moonshot:kimi-k2.6`,
    })

    expect(config).toMatchObject({
      provider: `moonshot`,
      model: `kimi-k2.6`,
    })
    expect(config.getApiKey).toBeTypeOf(`function`)
    expect(await config.getApiKey?.(`moonshot`)).toBe(`test-moonshot-key`)
  })
})
