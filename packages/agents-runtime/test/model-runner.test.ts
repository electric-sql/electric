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
    process.env = { ...originalEnv }
    delete process.env.MOONSHOT_API_KEY
    completeSimple.mockResolvedValue({
      content: [{ type: `text`, text: `ok` }],
      stopReason: `stop`,
      errorMessage: undefined,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
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

  test(`passes MOONSHOT_API_KEY for moonshot low-cost models`, async () => {
    process.env.MOONSHOT_API_KEY = `moonshot-key`

    await completeWithLowCostModel({
      catalog: {
        choices: [{ provider: `moonshot`, id: `kimi-k2.6`, reasoning: false }],
        defaultChoice: {
          provider: `moonshot`,
          id: `kimi-k2.6`,
          reasoning: false,
        },
      },
      purpose: `URL extraction`,
      systemPrompt: `Custom instructions`,
      prompt: `Extract the title`,
      maxTokens: 128,
    })

    expect(completeSimple).toHaveBeenCalledOnce()
    expect(completeSimple.mock.calls[0][0]).toMatchObject({
      provider: `moonshot`,
      id: `kimi-k2.6`,
      baseUrl: `https://api.moonshot.ai/v1`,
    })
    expect(completeSimple.mock.calls[0][2]).toMatchObject({
      apiKey: `moonshot-key`,
    })
  })
})

describe(`detectAvailableProviders`, () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.MOONSHOT_API_KEY
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

  test(`detects moonshot when MOONSHOT_API_KEY is set`, () => {
    process.env.MOONSHOT_API_KEY = `test-key`
    expect(detectAvailableProviders()).toContain(`moonshot`)
  })

  test(`does not include moonshot when MOONSHOT_API_KEY is absent`, () => {
    expect(detectAvailableProviders()).not.toContain(`moonshot`)
  })

  test(`detects multiple providers simultaneously`, () => {
    process.env.ANTHROPIC_API_KEY = `ant-key`
    process.env.DEEPSEEK_API_KEY = `ds-key`
    process.env.MOONSHOT_API_KEY = `moonshot-key`
    const providers = detectAvailableProviders()
    expect(providers).toContain(`anthropic`)
    expect(providers).toContain(`deepseek`)
    expect(providers).toContain(`moonshot`)
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

describe(`selectLowCostModelChoice with moonshot`, () => {
  test(`selects kimi-k2.6 as preferred moonshot low-cost model`, () => {
    const catalog = {
      choices: [
        { provider: `moonshot`, id: `kimi-k2.5`, reasoning: true },
        { provider: `moonshot`, id: `kimi-k2.6`, reasoning: true },
      ],
      defaultChoice: {
        provider: `moonshot`,
        id: `kimi-k2.5`,
        reasoning: true,
      },
    }
    const choice = selectLowCostModelChoice(catalog, {
      provider: `moonshot`,
      model: `kimi-k2.5`,
    })
    expect(choice.provider).toBe(`moonshot`)
    expect(choice.id).toBe(`kimi-k2.6`)
  })
})
