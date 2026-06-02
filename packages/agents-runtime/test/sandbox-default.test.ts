import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chooseDefaultSandbox } from '../src/sandbox/default'

/**
 * chooseDefaultSandbox(workingDirectory): the runtime helper that picks
 * the default Sandbox provider for built-in entities (Horton, Worker).
 * Always returns `unrestrictedSandbox`; stronger isolation is opt-in via
 * `dockerSandbox` / `remoteSandbox`.
 */
describe(`chooseDefaultSandbox`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `sandbox-default-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`returns unrestrictedSandbox`, async () => {
    const sandbox = await chooseDefaultSandbox(cwd)
    try {
      expect(sandbox.name).toBe(`unrestricted`)
      expect(sandbox.workingDirectory).toBe(cwd)
    } finally {
      await sandbox.dispose()
    }
  })
})
