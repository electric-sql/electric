import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, parseConfig } from '../../src/config/loader'

const fixture = (name: string) =>
  readFileSync(join(__dirname, `../fixtures`, name), `utf8`)

describe(`config loader`, () => {
  it(`parses valid config`, () => {
    const cfg = parseConfig(fixture(`valid.json`))
    expect(Object.keys(cfg.servers)).toEqual([`github`, `git-local`])
    expect(cfg.servers.github.transport).toBe(`http`)
  })
  it(`rejects invalid auth mode`, () => {
    expect(() => parseConfig(fixture(`invalid-mode.json`))).toThrow(
      /auth.*mode/
    )
  })
  it(`loadConfig reads from path`, async () => {
    const cfg = await loadConfig(join(__dirname, `../fixtures/valid.json`))
    expect(cfg.servers.github).toBeDefined()
  })
})
