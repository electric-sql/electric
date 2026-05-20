import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBashTool } from '../src/tools/bash'

describe(`bash tool`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `bash-tool-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`runs commands in the working directory without overriding HOME`, async () => {
    const tool = createBashTool(cwd)
    const result = await tool.execute(`call-1`, {
      command: `node -e "console.log(process.cwd()); console.log(process.env.HOME)"`,
    })

    expect(result.details).toMatchObject({ exitCode: 0, timedOut: false })
    const lines = (result.content[0] as { text: string }).text
      .trim()
      .split(`\n`)
    expect(lines).toEqual([await realpath(cwd), process.env.HOME ?? homedir()])
  })

  it(`forwards PATH to the child process`, async () => {
    const tool = createBashTool(cwd)
    const result = await tool.execute(`call-path`, {
      command: `printf '%s' "$PATH"`,
    })
    expect((result.content[0] as { text: string }).text).toBe(
      process.env.PATH ?? ``
    )
  })

  it(`does NOT forward ANTHROPIC_API_KEY (or other unlisted vars)`, async () => {
    const sentinel = `sk-test-bash-leak-${Date.now()}`
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = sentinel
    try {
      const tool = createBashTool(cwd)
      const result = await tool.execute(`call-key`, {
        command: `printf '%s' "$ANTHROPIC_API_KEY"`,
      })
      // Empty stdout renders as "(no output)"; check just that the secret didn't appear.
      expect((result.content[0] as { text: string }).text).not.toContain(
        sentinel
      )
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })

  it(`forwards variables named in allowedEnvKeys (extending the defaults)`, async () => {
    const sentinel = `bash-allowlist-extend-${Date.now()}`
    const prev = process.env.MY_CUSTOM
    process.env.MY_CUSTOM = sentinel
    try {
      const tool = createBashTool(cwd, { allowedEnvKeys: [`MY_CUSTOM`] })
      const result = await tool.execute(`call-custom`, {
        command: `printf '%s' "$MY_CUSTOM"`,
      })
      expect((result.content[0] as { text: string }).text).toBe(sentinel)
    } finally {
      if (prev === undefined) delete process.env.MY_CUSTOM
      else process.env.MY_CUSTOM = prev
    }
  })

  it(`allowedEnvKeys extends defaults; PATH still passes through when other keys are added`, async () => {
    const tool = createBashTool(cwd, { allowedEnvKeys: [`MY_CUSTOM`] })
    const result = await tool.execute(`call-extend-path`, {
      command: `printf '%s' "$PATH"`,
    })
    expect((result.content[0] as { text: string }).text).toBe(
      process.env.PATH ?? ``
    )
  })
})
