import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBuiltinModelCatalog,
  resolveBuiltinModelConfig,
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
      reasoning: { effort: `high` },
    })
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
})
