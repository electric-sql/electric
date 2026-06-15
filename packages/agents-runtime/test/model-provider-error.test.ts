import { describe, expect, it } from 'vitest'
import {
  classifyModelProviderError,
  modelProviderErrorMessage,
  toModelProviderError,
} from '../src/model-provider-error'

describe(`model provider error classification`, () => {
  it.each([
    [new Error(`fetch failed`), `MODEL_PROVIDER_UNREACHABLE`],
    [new Error(`ENOTFOUND api.anthropic.com`), `MODEL_PROVIDER_UNREACHABLE`],
    [new Error(`timeout`), `MODEL_PROVIDER_TIMEOUT`],
    [new Error(`request timed out`), `MODEL_PROVIDER_TIMEOUT`],
    [new Error(`401 invalid api key`), `MODEL_PROVIDER_AUTH_FAILED`],
    [new Error(`authentication failed`), `MODEL_PROVIDER_AUTH_FAILED`],
    [new Error(`429 rate limit`), `MODEL_PROVIDER_RATE_LIMITED`],
    [new Error(`503 overloaded`), `MODEL_PROVIDER_UNAVAILABLE`],
    [new Error(`something unexpected`), `MODEL_PROVIDER_ERROR`],
  ] as const)(`classifies %s as %s`, (error, code) => {
    expect(classifyModelProviderError(error)).toBe(code)
  })

  it(`creates friendly provider-specific messages with original detail`, () => {
    const error = toModelProviderError(new Error(`fetch failed`), {
      provider: `anthropic`,
      model: `claude-sonnet-4-5`,
    })

    expect(error.code).toBe(`MODEL_PROVIDER_UNREACHABLE`)
    expect(error.message).toContain(`Could not reach Anthropic`)
    expect(error.message).toContain(`fetch failed`)
  })

  it(`has a timeout message`, () => {
    expect(
      modelProviderErrorMessage({
        code: `MODEL_PROVIDER_TIMEOUT`,
        provider: `openai`,
      })
    ).toContain(`OpenAI did not respond`)
  })
})
