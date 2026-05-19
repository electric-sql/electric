import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { createReadFileTool } from '../src/tools/read-file'
import { createWriteTool } from '../src/tools/write'

// End-to-end coverage that read/write/edit reject escape paths and that
// the target on the other side of an escape symlink is left untouched.
// Path-resolution semantics themselves are exercised in path-guard.test.ts.
describe(`tool path traversal`, () => {
  let cwd: string
  let outside: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `path-symlink-`))
    outside = await mkdtemp(join(tmpdir(), `path-outside-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it(`read rejects an escape symlink with the guard's error message`, async () => {
    const secret = join(outside, `secret.txt`)
    await writeFile(secret, `secret data`, `utf-8`)
    await symlink(secret, join(cwd, `link.txt`))
    const tool = createReadFileTool(cwd)
    const result = await tool.execute(`r`, { path: `link.txt` })
    expect((result.content[0] as { text: string }).text).toMatch(
      /resolves outside the working directory via a symlink/
    )
  })

  it(`write rejects an escape symlink and leaves the outside target untouched`, async () => {
    const target = join(outside, `target.txt`)
    await writeFile(target, `original`, `utf-8`)
    await symlink(target, join(cwd, `link.txt`))
    const tool = createWriteTool(cwd)
    await tool.execute(`w`, { path: `link.txt`, content: `clobbered` })
    expect(await readFile(target, `utf-8`)).toBe(`original`)
  })

  it(`edit rejects an escape symlink even when the link is in readSet`, async () => {
    const target = join(outside, `t.txt`)
    await writeFile(target, `hello world`, `utf-8`)
    const linkPath = join(cwd, `link.txt`)
    await symlink(target, linkPath)
    const tool = createEditTool(cwd, new Set([linkPath]))
    const result = await tool.execute(`e`, {
      path: `link.txt`,
      old_string: `world`,
      new_string: `there`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /resolves outside the working directory via a symlink/
    )
    expect(await readFile(target, `utf-8`)).toBe(`hello world`)
  })
})
