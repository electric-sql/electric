import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBashTool } from '../src/tools/bash'
import { createReadFileTool } from '../src/tools/read-file'
import { createWriteTool } from '../src/tools/write'
import { createEditTool } from '../src/tools/edit'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

/**
 * Asserts the tool factories take a Sandbox (not a workingDirectory string)
 * and delegate filesystem/exec calls to it. Behavior is preserved relative
 * to the previous signatures — the refactor is plumbing.
 */
describe(`tool refactor to Sandbox`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `tool-refactor-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  describe(`bash`, () => {
    it(`runs commands through sandbox.exec, not raw child_process`, async () => {
      const calls: Array<unknown> = []
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const wrapped = {
        ...sandbox,
        exec: async (opts: unknown) => {
          calls.push(opts)
          return sandbox.exec(opts as Parameters<typeof sandbox.exec>[0])
        },
      }
      const tool = createBashTool(wrapped as typeof sandbox)
      const result = await tool.execute(`call-1`, { command: `echo hi` })
      expect(calls).toHaveLength(1)
      expect((result.content[0] as { text: string }).text.trim()).toBe(`hi`)
    })

    it(`does not forward arbitrary process.env to children`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const tool = createBashTool(sandbox)
      process.env.__SANDBOX_TEST_SECRET__ = `should-not-leak`
      try {
        const result = await tool.execute(`call`, {
          command: `node -e "console.log(process.env.__SANDBOX_TEST_SECRET__ ?? '<absent>')"`,
        })
        expect((result.content[0] as { text: string }).text.trim()).toBe(
          `<absent>`
        )
      } finally {
        delete process.env.__SANDBOX_TEST_SECRET__
      }
    })

    it(`description string no longer claims sandboxing`, () => {
      const sandbox = {
        name: `unrestricted`,
        workingDirectory: cwd,
      } as never
      const tool = createBashTool(sandbox)
      expect(tool.description.toLowerCase()).not.toMatch(/sandbox/)
    })
  })

  describe(`read`, () => {
    it(`reads via sandbox.readFile`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      await sandbox.writeFile(join(cwd, `f.txt`), `payload`)
      const tool = createReadFileTool(sandbox)
      const result = await tool.execute(`r`, { path: `f.txt` })
      expect((result.content[0] as { text: string }).text).toContain(
        `1: payload`
      )
    })

    it(`rejects paths that escape the working directory`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const tool = createReadFileTool(sandbox)
      const result = await tool.execute(`r`, { path: `../escape.txt` })
      expect((result.content[0] as { text: string }).text).toMatch(
        /outside the working directory/
      )
    })
  })

  describe(`write`, () => {
    it(`writes via sandbox.writeFile`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const tool = createWriteTool(sandbox)
      await tool.execute(`w`, { path: `out.txt`, content: `hello` })
      const buf = await sandbox.readFile(join(cwd, `out.txt`))
      expect(buf.toString(`utf-8`)).toBe(`hello`)
    })

    it(`creates parent directories via sandbox.mkdir`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      const tool = createWriteTool(sandbox)
      await tool.execute(`w`, {
        path: `nested/dir/leaf.txt`,
        content: `deep`,
      })
      const buf = await sandbox.readFile(join(cwd, `nested/dir/leaf.txt`))
      expect(buf.toString(`utf-8`)).toBe(`deep`)
    })
  })

  describe(`edit`, () => {
    it(`edits via sandbox.readFile + writeFile`, async () => {
      const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
      await sandbox.writeFile(join(cwd, `f.txt`), `hello world`)
      const readSet = new Set<string>()
      const readTool = createReadFileTool(sandbox, readSet)
      await readTool.execute(`r`, { path: `f.txt` })
      const editTool = createEditTool(sandbox)
      const result = await editTool.execute(`e`, {
        path: `f.txt`,
        old_string: `world`,
        new_string: `there`,
      })
      expect((result.content[0] as { text: string }).text).toMatch(
        /Edited|replacement/
      )
      const after = await sandbox.readFile(join(cwd, `f.txt`))
      expect(after.toString(`utf-8`)).toBe(`hello there`)
    })
  })
})
