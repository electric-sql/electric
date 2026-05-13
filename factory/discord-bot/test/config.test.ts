import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

describe(`loadConfig`, () => {
  const minimal = {
    DISCORD_BOT_TOKEN: `t`,
    DISCORD_PUBLIC_KEY: `pk`,
    DISCORD_APP_ID: `app`,
    AGENTS_SERVER_URL: `http://a`,
    AGENTS_SERVER_TOKEN: `s`,
    GITHUB_TOKEN: `gh`,
    GITHUB_REPO: `o/r`,
  }

  it(`parses required env vars`, () => {
    const cfg = loadConfig(minimal)
    expect(cfg.discord.botToken).toBe(`t`)
    expect(cfg.github.repo).toBe(`o/r`)
    expect(cfg.adapter.port).toBe(4449)
    expect(cfg.primeContext.messageLimit).toBe(20)
  })

  it(`throws when DISCORD_BOT_TOKEN is missing`, () => {
    const { DISCORD_BOT_TOKEN: _omit, ...rest } = minimal
    expect(() => loadConfig(rest)).toThrow(/DISCORD_BOT_TOKEN/)
  })

  it(`defaults HORTON_AGENTS_SERVER_URL to AGENTS_SERVER_URL`, () => {
    const cfg = loadConfig(minimal)
    expect(cfg.horton.agentsServerUrl).toBe(`http://a`)
    expect(cfg.horton.entityType).toBe(`horton`)
  })
})
