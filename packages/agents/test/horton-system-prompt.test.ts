import { describe, expect, it } from 'vitest'
import { buildHortonSystemPrompt } from '../src/agents/horton'

describe(`buildHortonSystemPrompt`, () => {
  it(`includes onboarding block by default`, () => {
    const prompt = buildHortonSystemPrompt(`/tmp/test`)
    expect(prompt).toContain(`# Onboarding`)
    expect(prompt).toContain(`quickstart`)
    expect(prompt).toContain(`init`)
  })

  it(`includes docs URL guidance when docsUrl is provided`, () => {
    const prompt = buildHortonSystemPrompt(`/tmp/test`, {
      docsUrl: `https://example.com/docs/agents`,
    })
    expect(prompt).toContain(`https://example.com/docs/agents`)
    expect(prompt).toContain(`fetch_url`)
  })

  it(`does not include docs URL section when docsUrl is not provided`, () => {
    const prompt = buildHortonSystemPrompt(`/tmp/test`)
    expect(prompt).not.toContain(`# Electric Agents documentation`)
  })

  it(`includes docs URL guidance alongside local docs support`, () => {
    const prompt = buildHortonSystemPrompt(`/tmp/test`, {
      hasDocsSupport: true,
      docsUrl: `https://example.com/docs/agents`,
    })
    expect(prompt).toContain(`search_durable_agents_docs`)
    expect(prompt).toContain(`https://example.com/docs/agents`)
  })

  it(`updates skill slash command reference to /quickstart`, () => {
    const prompt = buildHortonSystemPrompt(`/tmp/test`, { hasSkills: true })
    expect(prompt).toContain(`/quickstart`)
    expect(prompt).not.toContain(`/tutorial`)
  })
})
