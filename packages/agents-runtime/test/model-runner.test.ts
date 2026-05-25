import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const completeSimple = vi.fn()
const getModel = vi.fn(() => ({ provider: `openai-codex`, id: `gpt-5.4-mini` }))

vi.mock(`@mariozechner/pi-ai`, () => ({ completeSimple, getModel }))

const {
  completeWithLowCostModel,
  detectAvailableProviders,
  selectLowCostModelChoice,
} = await import(`../src/model-runner`)

const originalEnv = { ...process.env }

describe(`completeWithLowCostModel`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    completeSimple.mockResolvedValue({
      content: [{ type: `text`, text: `ok` }],
      stopReason: `stop`,
      errorMessage: undefined,
    })
  })

  test(`passes required system prompt`, async () => {
    await completeWithLowCostModel({
      catalog: {
        choices: [
          { provider: `openai-codex`, id: `gpt-5.4-mini`, reasoning: false },
        ],
      },
      purpose: `URL extraction`,
      systemPrompt: `Custom instructions`,
      prompt: `Extract the title`,
      maxTokens: 128,
    })

    expect(completeSimple).toHaveBeenCalledOnce()
    expect(completeSimple.mock.calls[0][1].systemPrompt).toBe(
      `Custom instructions`
    )
  })
})

describe(`detectAvailableProviders`, () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    process.env.CODEX_AUTH_PATH = `/nonexistent/auth.json`
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test(`detects deepseek when DEEPSEEK_API_KEY is set`, () => {
    process.env.DEEPSEEK_API_KEY = `test-key`
    expect(detectAvailableProviders()).toContain(`deepseek`)
  })

  test(`does not include deepseek when DEEPSEEK_API_KEY is absent`, () => {
    expect(detectAvailableProviders()).not.toContain(`deepseek`)
  })

  test(`detects multiple providers simultaneously`, () => {
    process.env.ANTHROPIC_API_KEY = `ant-key`
    process.env.DEEPSEEK_API_KEY = `ds-key`
    const providers = detectAvailableProviders()
    expect(providers).toContain(`anthropic`)
    expect(providers).toContain(`deepseek`)
  })
})

describe(`selectLowCostModelChoice with deepseek`, () => {
  test(`selects deepseek-v4-flash as preferred deepseek low-cost model`, () => {
    const catalog = {
      choices: [
        { provider: `deepseek`, id: `deepseek-v4-flash`, reasoning: true },
        { provider: `deepseek`, id: `deepseek-v4-pro`, reasoning: true },
      ],
      defaultChoice: {
        provider: `deepseek`,
        id: `deepseek-v4-flash`,
        reasoning: true,
      },
    }
    const choice = selectLowCostModelChoice(catalog, {
      provider: `deepseek`,
      model: `deepseek-v4-flash`,
    })
    expect(choice.provider).toBe(`deepseek`)
    expect(choice.id).toBe(`deepseek-v4-flash`)
  })
})
