import { describe, expect, it, vi } from 'vitest'
import { generateTitle } from '../src/agents/horton'

describe(`generateTitle`, () => {
  it(`uses the injected llmCall and returns its trimmed result`, async () => {
    const llmCall = vi.fn(async () => `  Refactor auth middleware  `) as any
    const result = await generateTitle(
      `Help me refactor the auth middleware`,
      llmCall
    )
    expect(result).toBe(`Refactor auth middleware`)
    expect(llmCall).toHaveBeenCalledTimes(1)
    const prompt = llmCall.mock.calls[0][0]
    expect(prompt).toBe(`User request:\nHelp me refactor the auth middleware`)
  })

  it(`falls back to a local title if the llm returns an empty response`, async () => {
    const llmCall = async () => ``
    const result = await generateTitle(
      `look into this error in horton.ts`,
      llmCall
    )
    expect(result).toBe(`Error Horton`)
  })

  it(`falls back to a local title if the llm call throws`, async () => {
    const llmCall = vi.fn(async () => {
      throw new Error(`500 Internal server error`)
    }) as any
    const result = await generateTitle(
      `Help me refactor the auth middleware in ./auth.ts`,
      llmCall
    )
    expect(result).toBe(`Refactor Auth Middleware`)
  })
})
