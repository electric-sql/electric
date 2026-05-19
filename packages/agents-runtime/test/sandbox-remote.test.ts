import { describe, expect, it, vi } from 'vitest'
import { remoteSandbox } from '../src/sandbox/remote'
import { SandboxError } from '../src/sandbox/types'
import type { RemoteSandboxClient } from '../src/sandbox/remote/types'

function makeFakeClient(): RemoteSandboxClient & {
  __calls: {
    exec: Array<{ cmd: string; cwd?: string }>
    read: Array<string>
    write: Array<{ path: string; size: number }>
    mkdir: Array<string>
    killed: boolean
  }
} {
  const calls = {
    exec: [] as Array<{ cmd: string; cwd?: string }>,
    read: [] as Array<string>,
    write: [] as Array<{ path: string; size: number }>,
    mkdir: [] as Array<string>,
    killed: false,
  }
  const files = new Map<string, Buffer>()
  return {
    __calls: calls,
    async exec(opts) {
      calls.exec.push({ cmd: opts.command, cwd: opts.cwd })
      return {
        stdout: Buffer.from(`stdout for ${opts.command}`),
        stderr: Buffer.from(``),
        exitCode: 0,
      }
    },
    async readFile(path) {
      calls.read.push(path)
      const buf = files.get(path)
      if (!buf) throw new Error(`ENOENT: ${path}`)
      return buf
    },
    async writeFile(path, content) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content)
      calls.write.push({ path, size: buf.length })
      files.set(path, buf)
    },
    async mkdir(path) {
      calls.mkdir.push(path)
    },
    async kill() {
      calls.killed = true
    },
  }
}

describe(`remoteSandbox`, () => {
  describe(`identity`, () => {
    it(`reports name 'remote:e2b' when constructed with an e2b client`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        expect(sandbox.name).toBe(`remote:e2b`)
        expect(sandbox.workingDirectory).toBe(`/work`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`exec`, () => {
    it(`delegates to the client with the configured cwd`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        const result = await sandbox.exec({ command: `ls -la` })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString()).toBe(`stdout for ls -la`)
        expect(client.__calls.exec).toEqual([{ cmd: `ls -la`, cwd: `/work` }])
      } finally {
        await sandbox.dispose()
      }
    })

    it(`overrides cwd from opts`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await sandbox.exec({ command: `pwd`, cwd: `/tmp` })
        expect(client.__calls.exec[0].cwd).toBe(`/tmp`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`filesystem`, () => {
    it(`writeFile + readFile roundtrip via the client`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await sandbox.writeFile(`/work/x.txt`, `hello`)
        const buf = await sandbox.readFile(`/work/x.txt`)
        expect(buf.toString(`utf-8`)).toBe(`hello`)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`writeFile rejects paths outside the working directory`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await expect(
          sandbox.writeFile(`/etc/passwd`, `nope`)
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`mkdir delegates to the client`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await sandbox.mkdir(`/work/nested/deep`, { recursive: true })
        expect(client.__calls.mkdir).toContain(`/work/nested/deep`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`fetch`, () => {
    it(`rejects hosts not in allowedHosts`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
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
  })

  describe(`lifecycle`, () => {
    it(`dispose kills the underlying remote workspace exactly once`, async () => {
      const client = makeFakeClient()
      const killSpy = vi.spyOn(client, `kill`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      await sandbox.dispose()
      expect(killSpy).toHaveBeenCalledTimes(1)
      // Second dispose is a no-op — kill is not called again.
      await sandbox.dispose()
      expect(killSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe(`provider loading`, () => {
    it(`throws unavailable when no client and e2b is not installed`, async () => {
      // Force the dynamic loader to fail by passing an unknown provider.
      await expect(
        remoteSandbox({
          provider: `unknown` as never,
          workingDirectory: `/work`,
        })
      ).rejects.toBeInstanceOf(SandboxError)
    })
  })
})
