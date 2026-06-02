import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'
import { SandboxError } from '../src/sandbox/types'

/**
 * Containment is a sandbox concern. The unrestricted provider shares the
 * host filesystem, so it is the one that must resolve paths (following
 * symlinks) and reject anything that escapes the working directory with a
 * `policy` SandboxError — the defense the tool layer used to perform via
 * resolveSafePath now lives here, where the filesystem actually is.
 */
describe(`unrestrictedSandbox workspace containment`, () => {
  let cwd: string
  let outside: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `unrestricted-contain-cwd-`))
    outside = await mkdtemp(join(tmpdir(), `unrestricted-contain-out-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it(`readFile rejects a relative ../ escape with a policy error`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    await writeFile(join(outside, `secret.txt`), `s3cret`, `utf-8`)
    try {
      await expect(sandbox.readFile(`../secret.txt`)).rejects.toMatchObject({
        kind: `policy`,
      })
    } finally {
      await sandbox.dispose()
    }
  })

  it(`writeFile rejects an absolute path outside the workspace`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      await expect(
        sandbox.writeFile(join(outside, `leaked.txt`), `nope`)
      ).rejects.toBeInstanceOf(SandboxError)
      await expect(
        sandbox.writeFile(join(outside, `leaked.txt`), `nope`)
      ).rejects.toMatchObject({ kind: `policy` })
    } finally {
      await sandbox.dispose()
    }
  })

  it(`readFile follows a symlink and rejects when the target escapes`, async () => {
    await writeFile(join(outside, `secret.txt`), `s3cret`, `utf-8`)
    await symlink(join(outside, `secret.txt`), join(cwd, `link.txt`))
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      await expect(sandbox.readFile(`link.txt`)).rejects.toMatchObject({
        kind: `policy`,
      })
    } finally {
      await sandbox.dispose()
    }
  })

  it(`writeFile rejects when a parent component is a symlink out of the workspace`, async () => {
    await mkdir(join(outside, `target-dir`))
    await symlink(join(outside, `target-dir`), join(cwd, `linked-dir`))
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      await expect(
        sandbox.writeFile(`linked-dir/leaked.txt`, `nope`)
      ).rejects.toMatchObject({ kind: `policy` })
    } finally {
      await sandbox.dispose()
    }
  })

  it(`mkdir and stat reject escapes with a policy error`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      await expect(sandbox.mkdir(`../new-dir`)).rejects.toMatchObject({
        kind: `policy`,
      })
      await expect(
        sandbox.stat(join(outside, `secret.txt`))
      ).rejects.toMatchObject({ kind: `policy` })
    } finally {
      await sandbox.dispose()
    }
  })

  it(`exists returns false (not throw) for a denied path — safe-probe semantics`, async () => {
    await writeFile(join(outside, `secret.txt`), `s3cret`, `utf-8`)
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      expect(await sandbox.exists(join(outside, `secret.txt`))).toBe(false)
      expect(await sandbox.exists(`../secret.txt`)).toBe(false)
    } finally {
      await sandbox.dispose()
    }
  })

  it(`still serves paths inside the workspace`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      await sandbox.mkdir(`nested`, { recursive: true })
      await sandbox.writeFile(`nested/ok.txt`, `inside`)
      expect((await sandbox.readFile(`nested/ok.txt`)).toString()).toBe(
        `inside`
      )
      expect(await sandbox.exists(`nested/ok.txt`)).toBe(true)
      expect((await sandbox.stat(`nested/ok.txt`)).type).toBe(`file`)
    } finally {
      await sandbox.dispose()
    }
  })
})
