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

  // The env-scrubbing characterization tests from #4354 documented the
  // pre-fix bash env leak. Those expectations have been inverted by PR 6a's
  // env scrub (see sandbox-tool-refactor.test.ts > 'does not forward
  // arbitrary process.env to children'). The characterizations are removed
  // because their assertions no longer match the fixed behavior.
})
