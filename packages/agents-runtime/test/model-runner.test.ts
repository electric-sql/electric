import { beforeEach, describe, expect, test, vi } from 'vitest'

const completeSimple = vi.fn()
const getModel = vi.fn(() => ({ provider: `openai-codex`, id: `gpt-5.4-mini` }))

vi.mock(`@earendil-works/pi-ai`, () => ({ completeSimple, getModel }))

const { completeWithLowCostModel } = await import(`../src/model-runner`)

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
