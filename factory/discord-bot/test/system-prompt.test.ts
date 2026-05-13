import { describe, it, expect } from 'vitest'
import { buildDiscordBotSystemPrompt } from '../src/system-prompt'

describe(`buildDiscordBotSystemPrompt`, () => {
  it(`mentions the configured repo and tool guidance`, () => {
    const prompt = buildDiscordBotSystemPrompt({
      githubRepo: `electric-sql/electric`,
    })
    expect(prompt).toContain(`electric-sql/electric`)
    expect(prompt).toContain(`spawn_horton`)
    expect(prompt).toContain(`post_message`)
    expect(prompt).toContain(`GitHub MCP`)
    expect(prompt).toMatch(/clarif/i)
  })

  it(`omits docs guidance when hasDocsSearch is false`, () => {
    const prompt = buildDiscordBotSystemPrompt({
      githubRepo: `o/r`,
      hasDocsSearch: false,
    })
    expect(prompt).not.toContain(`search_durable_agents_docs`)
  })
})
