import { describe, expect, it, vi } from 'vitest'
import { extractFirstUserMessage, generateTitle } from '../src/agents/horton'

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

  it(`falls back when the llm goes conversational instead of titling`, async () => {
    // e.g. an image message where the text-only title model apologizes.
    const llmCall = async () =>
      `I'm sorry but no images were actually shared in our conversation`
    const result = await generateTitle(`describe these screenshots`, llmCall)
    expect(result).toBe(`Describe These Screenshots`)
  })
})

describe(`extractFirstUserMessage`, () => {
  it(`uses composer_input source text for title generation`, async () => {
    const ctx = {
      db: {
        collections: {
          inbox: {
            toArray: [
              {
                from: `/principal/user%3A1`,
                _seq: 1,
                payload: {
                  source: `Help me test composer titles`,
                  nodes: [],
                },
              },
            ],
          },
        },
      },
    }

    await expect(extractFirstUserMessage(ctx as any)).resolves.toBe(
      `Help me test composer titles`
    )
  })
})
