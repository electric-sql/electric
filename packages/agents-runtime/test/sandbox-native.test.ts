import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { nativeSandbox } from '../src/sandbox/native'
import { SandboxError } from '../src/sandbox/types'

const supported =
  SandboxManager.isSupportedPlatform() &&
  SandboxManager.checkDependencies().errors.length === 0
const platformDescribe = supported ? describe : describe.skip

describe(`nativeSandbox`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `native-sandbox-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  describe(`identity`, () => {
    it(`exposes the canonical workingDirectory and a platform-specific name`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        // The adapter canonicalizes via realpath so subsequent FS policy
        // checks have a stable base. Callers can pass either canonical or
        // non-canonical paths.
        expect(sandbox.workingDirectory).toBe(await realpath(cwd))
        expect(sandbox.name).toMatch(
          /^native:(macos-seatbelt|linux-bwrap-only)$/
        )
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`filesystem policy (TS-level, enforced by adapter)`, () => {
    it(`readFile inside the working directory works`, async () => {
      await writeFile(join(cwd, `inside.txt`), `hello`, `utf-8`)
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        const buf = await sandbox.readFile(join(cwd, `inside.txt`))
        expect(buf.toString(`utf-8`)).toBe(`hello`)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`readFile rejects ~/.ssh paths via the default deny overlay`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        await expect(
          sandbox.readFile(join(homedir(), `.ssh`, `id_rsa`))
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`readFile rejects ~/.aws/credentials via the default deny overlay`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        await expect(
          sandbox.readFile(join(homedir(), `.aws`, `credentials`))
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`writeFile rejects paths outside the working directory`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        await expect(
          sandbox.writeFile(`/tmp/elsewhere-${Date.now()}.txt`, `nope`)
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`writeFile inside the working directory works`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        await sandbox.writeFile(join(cwd, `out.txt`), `payload`)
        const buf = await sandbox.readFile(join(cwd, `out.txt`))
        expect(buf.toString(`utf-8`)).toBe(`payload`)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`mkdir rejects paths outside the working directory`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        await expect(
          sandbox.mkdir(`/tmp/elsewhere-mkdir-${Date.now()}`, {
            recursive: true,
          })
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`fetch policy (via library HTTP proxy)`, () => {
    it(`rejects a fetch to a host not in allowedHosts`, async () => {
      const sandbox = await nativeSandbox({
        workingDirectory: cwd,
        allowedHosts: [`anthropic.com`],
      })
      try {
        await expect(
          sandbox.fetch(`https://example.com/`)
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`with no allowedHosts, rejects everything`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        await expect(
          sandbox.fetch(`https://anthropic.com/`)
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`lifecycle`, () => {
    it(`can be re-constructed after dispose`, async () => {
      const real = await realpath(cwd)
      const s1 = await nativeSandbox({ workingDirectory: cwd })
      await s1.dispose()
      const s2 = await nativeSandbox({ workingDirectory: cwd })
      expect(s2.workingDirectory).toBe(real)
      await s2.dispose()
    })

    it(`refuses concurrent exec with a conflicting working directory`, async () => {
      // Single-instance enforcement triggers on the first exec call —
      // pure FS/fetch instances can coexist because they never touch
      // SandboxManager. This matches the lazy-init pattern documented
      // in native.ts.
      const cwd2 = await mkdtemp(join(tmpdir(), `native-sandbox-other-`))
      const s1 = await nativeSandbox({ workingDirectory: cwd })
      const s2 = await nativeSandbox({ workingDirectory: cwd2 })
      try {
        await s1.exec({ command: `true` })
        await expect(s2.exec({ command: `true` })).rejects.toBeInstanceOf(
          SandboxError
        )
      } finally {
        await s2.dispose()
        await s1.dispose()
        await rm(cwd2, { recursive: true, force: true })
      }
    }, 30_000)
  })

  platformDescribe(`exec (real OS sandbox)`, () => {
    it(`runs a command inside the sandbox`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        const result = await sandbox.exec({ command: `echo hi` })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString().trim()).toBe(`hi`)
      } finally {
        await sandbox.dispose()
      }
    }, 30_000)

    it(`blocks reads of /etc/sudoers via cat under the sandbox`, async () => {
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        const result = await sandbox.exec({ command: `cat /etc/sudoers` })
        // Either non-zero exit or stderr indicates the read was blocked.
        // On macOS sandbox-exec, blocked reads emit "Operation not permitted".
        // On bwrap, the path is simply absent.
        const stderr = result.stderr.toString()
        const stdout = result.stdout.toString()
        expect(result.exitCode === 0 && stdout.includes(`#`)).toBe(false)
        expect(
          stderr.length > 0 || result.exitCode !== 0 || stdout.length === 0
        ).toBe(true)
      } finally {
        await sandbox.dispose()
      }
    }, 30_000)

    it(`allows writes inside the working directory`, async () => {
      await mkdir(cwd, { recursive: true })
      const sandbox = await nativeSandbox({ workingDirectory: cwd })
      try {
        const result = await sandbox.exec({
          command: `echo hello > ${cwd}/inside.txt && cat ${cwd}/inside.txt`,
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString().trim()).toBe(`hello`)
      } finally {
        await sandbox.dispose()
      }
    }, 30_000)
  })
})
