import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { remoteSandbox } from '../src/sandbox/remote'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'
import { dockerSandbox } from '../src/sandbox/docker'
import { SandboxError } from '../src/sandbox/types'
import { KNOWN_ADAPTERS } from '../src/sandbox'
import type { Sandbox } from '../src/sandbox/types'
import type { RemoteSandboxClient } from '../src/sandbox/remote/types'
import { dockerAvailable, TEST_IMAGE, TEST_LABEL } from './helpers/docker-probe'

/**
 * Cross-provider conformance: a single set of scenarios exercised against
 * unrestricted, remote (driven by an in-memory fake of an SDK matching
 * our RemoteSandboxClient contract), and docker (gated by daemon
 * availability). For scenarios where a provider has fundamentally
 * different semantics, the case is marked accordingly and the test
 * asserts the documented outcome for that provider.
 *
 * The contract this enforces:
 *   - exec is a real subprocess on unrestricted; a delegated call on
 *     remote; a container exec on docker.
 *   - writeFile + readFile roundtrip works.
 *   - writeFile outside the working directory is rejected with a
 *     SandboxError of kind 'policy'.
 *   - dispose is safe to call.
 */

interface ProviderCapabilities {
  /** AbortSignal on exec terminates the subprocess; false ⇒ best-effort/no-op. */
  supportsAbort: boolean
  /** getUrl returns a real network URL the host can hit. */
  supportsRealGetUrl: boolean
  /** updateNetworkPolicy enforces denials at the sandbox boundary. */
  enforcesNetworkPolicy: boolean
}

interface ProviderFactory {
  name: string
  /** The KNOWN_ADAPTERS slug this provider exercises. */
  adapter: (typeof KNOWN_ADAPTERS)[number]
  enabled: boolean
  capabilities: ProviderCapabilities
  /**
   * "Outside the working directory" probe path. For host-filesystem
   * providers (unrestricted) we use a host tempdir; for containerized
   * providers we use /etc/passwd which is outside the sandbox cwd but
   * always present in the container.
   */
  outsideKind: `host-tempdir` | `etc-passwd`
}

function makeFakeRemoteClient(): RemoteSandboxClient {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()
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
    async mkdir(path) {
      dirs.add(path)
    },
    async readdir(path) {
      const prefix = path.endsWith(`/`) ? path : path + `/`
      const seen = new Set<string>()
      const out: Array<{ name: string; type: `file` | `directory` }> = []
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue
        const rest = f.slice(prefix.length)
        const [first] = rest.split(`/`)
        if (!first || seen.has(first)) continue
        seen.add(first)
        out.push({
          name: first,
          type: rest.includes(`/`) ? `directory` : `file`,
        })
      }
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue
        const rest = d.slice(prefix.length)
        const [first] = rest.split(`/`)
        if (!first || seen.has(first)) continue
        seen.add(first)
        out.push({ name: first, type: `directory` })
      }
      return out
    },
    async exists(path) {
      if (files.has(path)) return true
      for (const d of dirs) if (d === path) return true
      return false
    },
    async remove(path, opts) {
      if (files.delete(path)) return
      if (opts?.recursive) {
        const prefix = path.endsWith(`/`) ? path : path + `/`
        for (const f of [...files.keys()])
          if (f.startsWith(prefix) || f === path) files.delete(f)
        for (const d of [...dirs])
          if (d.startsWith(prefix) || d === path) dirs.delete(d)
        return
      }
      const e: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`)
      e.code = `ENOENT`
      throw e
    },
    async stat(path) {
      const buf = files.get(path)
      if (buf) return { type: `file`, size: buf.length, mtimeMs: 0 }
      if (dirs.has(path)) return { type: `directory`, size: 0, mtimeMs: 0 }
      const e: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`)
      e.code = `ENOENT`
      throw e
    },
    async kill() {},
  }
}

const providers: Array<
  ProviderFactory & {
    create(workingDirectory: string): Promise<Sandbox>
  }
> = [
  {
    name: `unrestricted`,
    adapter: `unrestricted`,
    enabled: true,
    capabilities: {
      supportsAbort: true,
      supportsRealGetUrl: true, // loopback URL, host process is the server
      enforcesNetworkPolicy: false,
    },
    outsideKind: `host-tempdir`,
    create: (cwd) => unrestrictedSandbox({ workingDirectory: cwd }),
  },
  {
    name: `remote (fake)`,
    adapter: `remote`,
    enabled: true,
    capabilities: {
      // The in-memory fake doesn't forward signals or expose port URLs;
      // mid-session policy updates are TS-side only and *do* enforce
      // because the host-process fetch goes through the policy check.
      supportsAbort: false,
      supportsRealGetUrl: false,
      enforcesNetworkPolicy: true,
    },
    outsideKind: `etc-passwd`,
    create: (cwd) =>
      remoteSandbox({
        provider: `e2b`,
        workingDirectory: cwd,
        client: makeFakeRemoteClient(),
        initialNetworkPolicy: { mode: `allowlist`, allow: [`example.com`] },
      }),
  },
  {
    name: `docker`,
    adapter: `docker`,
    enabled: dockerAvailable,
    capabilities: {
      supportsAbort: true,
      supportsRealGetUrl: true,
      enforcesNetworkPolicy: true,
    },
    outsideKind: `etc-passwd`,
    create: () =>
      dockerSandbox({
        image: TEST_IMAGE,
        // Container workdir is the implicit /work; we ignore the host
        // tempdir argument — for containerized adapters the cwd is an
        // in-container path.
        workingDirectory: `/work`,
        initialNetworkPolicy: { mode: `allowlist`, allow: [`example.com`] },
        exposedPorts: [9999],
        labels: { [TEST_LABEL]: `1` },
      }),
  },
]

describe(`sandbox conformance`, () => {
  it(`every KNOWN_ADAPTERS slug is exercised by exactly one provider`, () => {
    const slugs = providers.map((p) => p.adapter).sort()
    const expected = [...KNOWN_ADAPTERS].sort()
    expect(slugs).toEqual(expected)
  })

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
          provider.outsideKind === `etc-passwd`
            ? `/etc/passwd`
            : `/tmp/conformance-outside-${Date.now()}.txt`
        try {
          if (provider.adapter === `unrestricted`) {
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

      it(`exists returns false for missing, true after writeFile`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const path = join(sandbox.workingDirectory, `exists.txt`)
          expect(await sandbox.exists(path)).toBe(false)
          await sandbox.writeFile(path, `hi`)
          expect(await sandbox.exists(path)).toBe(true)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`stat returns file metadata after writeFile`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const path = join(sandbox.workingDirectory, `meta.txt`)
          await sandbox.writeFile(path, `12345`)
          const s = await sandbox.stat(path)
          expect(s.type).toBe(`file`)
          expect(s.size).toBe(5)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`readdir lists entries written into the working directory`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const root = sandbox.workingDirectory
          await sandbox.writeFile(join(root, `a.txt`), `a`)
          await sandbox.writeFile(join(root, `b.txt`), `b`)
          await sandbox.mkdir(join(root, `sub`))
          const entries = await sandbox.readdir(root)
          const names = entries.map((e) => e.name).sort()
          expect(names).toContain(`a.txt`)
          expect(names).toContain(`b.txt`)
          expect(names).toContain(`sub`)
          const sub = entries.find((e) => e.name === `sub`)
          expect(sub?.type).toBe(`directory`)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`remove deletes a file and updates exists`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const path = join(sandbox.workingDirectory, `to-remove.txt`)
          await sandbox.writeFile(path, `bye`)
          expect(await sandbox.exists(path)).toBe(true)
          await sandbox.remove(path)
          expect(await sandbox.exists(path)).toBe(false)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`remove({recursive:true}) deletes a directory tree`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const sub = join(sandbox.workingDirectory, `tree`)
          await sandbox.mkdir(sub)
          await sandbox.writeFile(join(sub, `leaf.txt`), `x`)
          await sandbox.remove(sub, { recursive: true })
          expect(await sandbox.exists(sub)).toBe(false)
        } finally {
          await sandbox.dispose()
        }
      })

      it(`stat rejects for missing paths`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const missing = join(sandbox.workingDirectory, `nope.txt`)
          await expect(sandbox.stat(missing)).rejects.toThrow()
        } finally {
          await sandbox.dispose()
        }
      })

      it(`remove rejects nonexistent path (non-recursive)`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const missing = join(sandbox.workingDirectory, `nope.txt`)
          await expect(sandbox.remove(missing)).rejects.toThrow()
        } finally {
          await sandbox.dispose()
        }
      })

      it(`remove rejects a directory without recursive flag`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          const sub = join(sandbox.workingDirectory, `nonempty`)
          await sandbox.mkdir(sub)
          await sandbox.writeFile(join(sub, `leaf.txt`), `x`)
          await expect(sandbox.remove(sub)).rejects.toThrow()
        } finally {
          await sandbox.dispose()
        }
      })

      it.skipIf(!provider.capabilities.supportsAbort)(
        `exec honors AbortSignal mid-flight`,
        async () => {
          const sandbox = await provider.create(cwd)
          try {
            const ac = new AbortController()
            const p = sandbox.exec({
              command: `sleep 30`,
              timeoutMs: 5000,
              signal: ac.signal,
            })
            setTimeout(() => ac.abort(), 50)
            const r = await p
            expect(r.aborted).toBe(true)
            expect(r.timedOut).toBe(false)
            expect(r.exitCode === null || r.exitCode !== 0).toBe(true)
          } finally {
            await sandbox.dispose()
          }
        }
      )

      it.skipIf(!provider.capabilities.supportsAbort)(
        `exec returns immediately when signal is already aborted`,
        async () => {
          const sandbox = await provider.create(cwd)
          try {
            const ac = new AbortController()
            ac.abort()
            const r = await sandbox.exec({
              command: `sleep 30`,
              timeoutMs: 5000,
              signal: ac.signal,
            })
            expect(r.aborted).toBe(true)
            expect(r.timedOut).toBe(false)
          } finally {
            await sandbox.dispose()
          }
        }
      )

      it(`getUrl returns a URL string for a forwarded port`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          if (provider.capabilities.supportsRealGetUrl) {
            const url = await sandbox.getUrl({ port: 9999 })
            expect(typeof url).toBe(`string`)
            expect(() => new URL(url)).not.toThrow()
            const parsed = new URL(url)
            // Loopback providers preserve the requested port; tunnel /
            // Docker providers may remap to a host-side ephemeral port.
            // The contract is "a URL that resolves to that container port",
            // not "port equals the input".
            expect(parsed.port.length).toBeGreaterThan(0)
          } else {
            await expect(sandbox.getUrl({ port: 9999 })).rejects.toBeInstanceOf(
              SandboxError
            )
          }
        } finally {
          await sandbox.dispose()
        }
      })

      it(`updateNetworkPolicy(deny-all) blocks subsequent fetches`, async () => {
        const sandbox = await provider.create(cwd)
        try {
          if (!provider.capabilities.enforcesNetworkPolicy) {
            // unrestricted: documented no-op. Verify it doesn't throw.
            await sandbox.updateNetworkPolicy({ mode: `deny-all` })
            return
          }
          await sandbox.updateNetworkPolicy({ mode: `deny-all` })
          await expect(
            sandbox.fetch(`https://blocked.example.invalid/`)
          ).rejects.toMatchObject({ kind: `policy` })
          // Loosen — verify the call itself succeeds; we don't probe the
          // network because hosts like `.invalid` would race DNS failure
          // against the policy gate in unpredictable ways.
          await sandbox.updateNetworkPolicy({
            mode: `allowlist`,
            allow: [`allowed.example.invalid`],
          })
        } finally {
          await sandbox.dispose()
        }
      })
    })
  }

  // Symlink escape — pertinent for unrestricted (real host filesystem).
  // Skip for remote (VM-rooted, fake doesn't model symlinks) and docker
  // (container fs, host workdir isn't mounted in).
  for (const provider of providers.filter(
    (p) => p.outsideKind === `host-tempdir`
  )) {
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
          if (provider.adapter === `unrestricted`) {
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
