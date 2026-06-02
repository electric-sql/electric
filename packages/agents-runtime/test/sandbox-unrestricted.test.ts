import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

describe(`unrestrictedSandbox`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `unrestricted-sandbox-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  describe(`identity`, () => {
    it(`reports name 'unrestricted' and exposes workingDirectory`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      expect(sandbox.name).toBe(`unrestricted`)
      expect(sandbox.workingDirectory).toBe(cwd)
      await sandbox.dispose()
    })
  })

  describe(`exec`, () => {
    it(`runs a shell command in the working directory`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const result = await sandbox.exec({ command: `pwd` })
      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.stdout.toString().trim()).toBe(await realpath(cwd))
      await sandbox.dispose()
    })

    it(`captures stderr separately from stdout`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const result = await sandbox.exec({
        command: `echo out && echo err >&2`,
      })
      expect(result.stdout.toString().trim()).toBe(`out`)
      expect(result.stderr.toString().trim()).toBe(`err`)
      await sandbox.dispose()
    })

    it(`reports non-zero exit codes`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const result = await sandbox.exec({ command: `exit 42` })
      expect(result.exitCode).toBe(42)
      await sandbox.dispose()
    })

    it(`enforces timeoutMs and sets timedOut`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const result = await sandbox.exec({
        command: `sleep 5`,
        timeoutMs: 100,
      })
      expect(result.timedOut).toBe(true)
      await sandbox.dispose()
    })

    it(`truncates output to maxOutputBytes and reports it`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const result = await sandbox.exec({
        command: `node -e "process.stdout.write('x'.repeat(1000))"`,
        maxOutputBytes: 100,
      })
      expect(result.stdout.length).toBeLessThanOrEqual(100)
      expect(result.outputTruncated).toBe(true)
      await sandbox.dispose()
    })

    it(`passes env from opts merged onto the sandbox base`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const result = await sandbox.exec({
        command: `node -e "console.log(process.env.MY_VAR)"`,
        env: { MY_VAR: `hello` },
      })
      expect(result.stdout.toString().trim()).toBe(`hello`)
      await sandbox.dispose()
    })
  })

  describe(`readFile`, () => {
    it(`reads file contents as a Buffer`, async () => {
      await writeFile(join(cwd, `f.txt`), `hello`, `utf-8`)
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const buf = await sandbox.readFile(join(cwd, `f.txt`))
      expect(buf).toBeInstanceOf(Buffer)
      expect(buf.toString(`utf-8`)).toBe(`hello`)
      await sandbox.dispose()
    })

    it(`propagates ENOENT for missing files`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      await expect(sandbox.readFile(join(cwd, `missing.txt`))).rejects.toThrow()
      await sandbox.dispose()
    })
  })

  describe(`writeFile`, () => {
    it(`writes string content as utf-8`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      await sandbox.writeFile(join(cwd, `out.txt`), `world`)
      const buf = await sandbox.readFile(join(cwd, `out.txt`))
      expect(buf.toString(`utf-8`)).toBe(`world`)
      await sandbox.dispose()
    })

    it(`writes Buffer content verbatim`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const payload = Buffer.from([0x00, 0x01, 0x02, 0xff])
      await sandbox.writeFile(join(cwd, `bin`), payload)
      const buf = await sandbox.readFile(join(cwd, `bin`))
      expect(buf.equals(payload)).toBe(true)
      await sandbox.dispose()
    })
  })

  describe(`mkdir`, () => {
    it(`creates nested directories with recursive: true`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      await sandbox.mkdir(join(cwd, `a/b/c`), { recursive: true })
      await sandbox.writeFile(join(cwd, `a/b/c/leaf.txt`), `here`)
      const buf = await sandbox.readFile(join(cwd, `a/b/c/leaf.txt`))
      expect(buf.toString(`utf-8`)).toBe(`here`)
      await sandbox.dispose()
    })
  })

  describe(`fetch`, () => {
    it(`returns a Response from a successful HTTP call`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      // Use a data: URL so the test does not depend on network.
      const dataUrl = `data:text/plain;base64,aGVsbG8=`
      const res = await sandbox.fetch(dataUrl)
      expect(res.ok).toBe(true)
      expect(await res.text()).toBe(`hello`)
      await sandbox.dispose()
    })
  })

  describe(`dispose`, () => {
    it(`returns a resolved promise`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      await expect(sandbox.dispose()).resolves.toBeUndefined()
    })
  })
})
