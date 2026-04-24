import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/config/config-store'

describe(`ConfigStore`, () => {
  let workDir: string
  let store: ConfigStore

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-test-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    store = new ConfigStore(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`returns empty config when no file exists`, () => {
    const config = store.load()
    expect(config.servers).toEqual({})
  })

  it(`reads config from .electric-agents/mcp.json`, () => {
    const dir = join(workDir, `.electric-agents`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `mcp.json`),
      JSON.stringify({
        servers: {
          github: { command: `npx`, args: [`-y`, `@mcp/server-github`] },
        },
      })
    )
    const config = store.load()
    expect(config.servers.github).toBeDefined()
    expect(config.servers.github!.command).toBe(`npx`)
  })

  it(`saves config and creates .gitignore`, () => {
    store.save({
      servers: { test: { command: `echo`, args: [`hi`] } },
    })
    const dir = join(workDir, `.electric-agents`)
    expect(existsSync(join(dir, `mcp.json`))).toBe(true)
    const gitignore = readFileSync(join(dir, `.gitignore`), `utf-8`)
    expect(gitignore).toContain(`mcp-auth.json`)
  })

  it(`adds a server to existing config`, () => {
    store.save({ servers: { a: { command: `a` } } })
    store.addServer(`b`, { command: `b` })
    const config = store.load()
    expect(Object.keys(config.servers)).toEqual([`a`, `b`])
  })

  it(`removes a server from config`, () => {
    store.save({ servers: { a: { command: `a` }, b: { command: `b` } } })
    store.removeServer(`a`)
    const config = store.load()
    expect(Object.keys(config.servers)).toEqual([`b`])
  })

  it(`expands env vars when loading`, () => {
    const dir = join(workDir, `.electric-agents`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `mcp.json`),
      JSON.stringify({
        servers: {
          s: { command: `echo`, env: { TOKEN: `\${TEST_TOKEN_CFG}` } },
        },
      })
    )
    process.env.TEST_TOKEN_CFG = `secret123`
    const config = store.load({ expandEnv: true })
    expect(config.servers.s!.env!.TOKEN).toBe(`secret123`)
    delete process.env.TEST_TOKEN_CFG
  })
})
