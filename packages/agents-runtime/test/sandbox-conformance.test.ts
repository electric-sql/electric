import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { nativeSandbox } from '../src/sandbox/native'
import { remoteSandbox } from '../src/sandbox/remote'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'
import { SandboxError } from '../src/sandbox/types'
import type { Sandbox } from '../src/sandbox/types'
import type { RemoteSandboxClient } from '../src/sandbox/remote/types'

/**
 * Cross-provider conformance: a single set of scenarios exercised against
 * unrestricted, native (real OS sandbox, gated by platform support), and
 * remote (driven by an in-memory fake of an SDK matching our
 * RemoteSandboxClient contract). For scenarios where a provider has
 * fundamentally different semantics, the case is marked accordingly and
 * the test asserts the documented outcome for that provider.
 *
 * The contract this enforces:
 *   - exec is a real subprocess on unrestricted/native; a delegated call
 *     on remote.
 *   - writeFile + readFile roundtrip works.
 *   - writeFile outside the working directory is rejected with a
 *     SandboxError of kind 'policy'.
 *   - dispose is safe to call.
 */

interface ProviderFactory {
  name: string
  enabled: boolean
  create(workingDirectory: string): Promise<Sandbox>
}

const nativeSupported =
  SandboxManager.isSupportedPlatform() &&
  SandboxManager.checkDependencies().errors.length === 0

function makeFakeRemoteClient(): RemoteSandboxClient {
  const files = new Map<string, Buffer>()
  return {
    async exec(opts) {
      // Minimal fake exec that handles a few shell patterns we use in the
      // conformance scenarios. Real provider execs run inside a VM; this
      // fake satisfies the interface contract without simulating shell.
      const cmd = opts.command
      if (cmd.startsWith(`echo `)) {
        const out = cmd.slice(5).replace(/^['"]|['"]$/g, ``)
        return {
          stdout: Buffer.from(out + `\n`),
          stderr: Buffer.from(``),
          exitCode: 0,
        }
      }
      return {
        stdout: Buffer.from(``),
        stderr: Buffer.from(``),
        exitCode: 0,
      }
    },
    async readFile(path) {
      const buf = files.get(path)
      if (!buf) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`)
        e.code = `ENOENT`
        throw e
      }
      return buf
    },
    async writeFile(path, content) {
      files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content))
    },
    async mkdir() {},
    async kill() {},
  }
}

const providers: Array<ProviderFactory> = [
  {
    name: `unrestricted`,
    enabled: true,
    create: (cwd) => unrestrictedSandbox({ workingDirectory: cwd }),
  },
  {
    name: `native`,
    enabled: nativeSupported,
    create: (cwd) => nativeSandbox({ workingDirectory: cwd }),
  },
  {
    name: `remote (fake)`,
    enabled: true,
    create: (cwd) =>
      remoteSandbox({
        provider: `e2b`,
        workingDirectory: cwd,
        client: makeFakeRemoteClient(),
      }),
  },
]

describe(`sandbox conformance`, () => {
  for (const provider of providers) {
    const d = provider.enabled ? describe : describe.skip
    d(provider.name, () => {
      let cwd: string

      beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), `conformance-${provider.name}-`))
      })

      afterEach(async () => {
        await rm(cwd, { recursive: true, force: true })
      })

      it(`writeFile + readFile roundtrip inside the working directory`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const path = join(sandbox.workingDirectory, `roundtrip.txt`)
          await sandbox.writeFile(path, `payload`)
          const buf = await sandbox.readFile(path)
          expect(buf.toString(`utf-8`)).toBe(`payload`)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`writeFile outside the working directory matches the provider's documented policy`, async () => {
        const sandbox = await provider.create(cwd)
        const outside =
          provider.name === `remote (fake)`
            ? `/etc/passwd`
            : `/tmp/conformance-outside-${Date.now()}.txt`
        try {
          if (provider.name === `unrestricted`) {
            // Documented: unrestricted has no policy boundary; path
            // security is the tool layer's job (resolveSafePath in
            // src/tools). Sandbox.writeFile here delegates straight to
            // node:fs and succeeds.
            await sandbox.writeFile(outside, `unrestricted`)
            await rm(outside, { force: true })
          } else {
            await expect(
              sandbox.writeFile(outside, `nope`)
            ).rejects.toBeInstanceOf(SandboxError)
            await expect(
              sandbox.writeFile(outside, `nope`)
            ).rejects.toMatchObject({ kind: `policy` })
          }
        } finally {
          await sandbox.dispose()
        }
      })

      it(`exec returns a result with exitCode`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const r = await sandbox.exec({ command: `echo hello` })
          expect(r.exitCode).toBe(0)
          expect(r.stdout.toString().trim()).toBe(`hello`)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`dispose is safe (does not throw)`, async () => {
        const sandbox = await provider.create(cwd)
        await expect(sandbox.dispose()).resolves.toBeUndefined()
      })

      it(`exposes name and workingDirectory`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          expect(sandbox.name.length).toBeGreaterThan(0)
          expect(sandbox.workingDirectory.length).toBeGreaterThan(0)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`readFile rejects ENOENT for missing files`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const missing = join(sandbox.workingDirectory, `does-not-exist.txt`)
          await expect(sandbox.readFile(missing)).rejects.toThrow()
        } finally {
          await sandbox.dispose()
        }
      })
    })
  }

  // Symlink escape — pertinent for unrestricted and native (real host
  // filesystem). Skip for remote since paths are VM-rooted and we don't
  // build symlinks in the fake.
  for (const provider of providers.filter((p) => p.name !== `remote (fake)`)) {
    const d = provider.enabled ? describe : describe.skip
    d(`${provider.name} — symlink escape`, () => {
      let cwd: string
      let outside: string

      beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), `conformance-sym-${provider.name}-`))
        outside = await mkdtemp(
          join(tmpdir(), `conformance-sym-out-${provider.name}-`)
        )
      })

      afterEach(async () => {
        await rm(cwd, { recursive: true, force: true })
        await rm(outside, { recursive: true, force: true })
      })

      it(`readFile rejects a symlink pointing outside the workspace`, async () => {
        const { symlink } = await import(`node:fs/promises`)
        await writeFile(join(outside, `secret`), `s3cret`, `utf-8`)
        await symlink(join(outside, `secret`), join(cwd, `link`))

        const sandbox = await provider.create(cwd)
        try {
          if (provider.name === `unrestricted`) {
            // Unrestricted has no policy boundary; the read succeeds.
            // Documented behavior: symlink defense lives in the tool layer
            // (resolveSafePath) for unrestricted, not in the sandbox.
            const buf = await sandbox.readFile(join(cwd, `link`))
            expect(buf.toString()).toBe(`s3cret`)
          } else {
            await expect(
              sandbox.readFile(join(cwd, `link`))
            ).rejects.toBeInstanceOf(SandboxError)
          }
        } finally {
          await sandbox.dispose()
        }
      })
    })
  }
})
