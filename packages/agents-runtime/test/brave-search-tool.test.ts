import { describe, expect, it } from 'vitest'
import { braveSearchTool } from '../src/tools'

describe(`braveSearchTool`, () => {
  it(`is exposed to agents as web_search`, () => {
    expect(braveSearchTool.name).toBe(`web_search`)
  })

  it(`does not require Anthropic when Brave search is not configured`, async () => {
    const previousBraveKey = process.env.BRAVE_SEARCH_API_KEY
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY
    delete process.env.BRAVE_SEARCH_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      const result = await braveSearchTool.execute(`tool-call`, {
        query: `ElectricSQL`,
      })

      const firstBlock = result.content[0]
      expect(firstBlock?.type).toBe(`text`)
      expect(
        firstBlock && `text` in firstBlock ? firstBlock.text : ``
      ).toContain(`Search unavailable`)
      expect(result.details.resultCount).toBe(0)
    } finally {
      if (previousBraveKey === undefined) {
        delete process.env.BRAVE_SEARCH_API_KEY
      } else {
        process.env.BRAVE_SEARCH_API_KEY = previousBraveKey
      }
      if (previousAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropicKey
      }
    }
  })
})
