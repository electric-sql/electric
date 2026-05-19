import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBashTool } from '../src/tools/bash'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

describe(`bash tool`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `bash-tool-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`runs commands in the working directory and exposes HOME from the sandbox`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const tool = createBashTool(sandbox)
    const result = await tool.execute(`call-1`, {
      command: `node -e "console.log(process.cwd()); console.log(process.env.HOME)"`,
    })

    expect(result.details).toMatchObject({ exitCode: 0, timedOut: false })
    const lines = (result.content[0] as { text: string }).text
      .trim()
      .split(`\n`)
    expect(lines[0]).toBe(await realpath(cwd))
    expect(lines[1]).toBe(process.env.HOME ?? ``)
    await sandbox.dispose()
  })

  // Characterization: the bash tool currently passes `env: { ...process.env }`
  // wholesale to spawned children (`bash.ts:23`). The two tests below capture
  // that behavior so the env-scrubbing change planned for a follow-up PR has
  // an explicit regression target.
  it(`leaks the parent PATH into the child process (no env scrubbing)`, async () => {
    const tool = createBashTool(cwd)
    const result = await tool.execute(`call-path`, {
      command: `printf '%s' "$PATH"`,
    })
    expect((result.content[0] as { text: string }).text).toBe(
      process.env.PATH ?? ``
    )
  })

  it(`leaks an ANTHROPIC_API_KEY-style env var to the child process`, async () => {
    const sentinel = `sk-test-bash-leak-${Date.now()}`
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = sentinel
    try {
      const tool = createBashTool(cwd)
      const result = await tool.execute(`call-key`, {
        command: `printf '%s' "$ANTHROPIC_API_KEY"`,
      })
      expect((result.content[0] as { text: string }).text).toBe(sentinel)
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })
})
