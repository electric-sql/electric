import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { createReadFileTool } from '../src/tools/read-file'
import { createWriteTool } from '../src/tools/write'

// Characterization: read/write/edit guard the working directory using a
// path-prefix check (resolve + relative + startsWith('..')) but do NOT call
// `realpath`, so a symlink inside the working directory that points outside
// is followed transparently — CVE-2025-53109/53110 class bypass. A follow-up
// PR will add realpath resolution; update these expectations when it lands.
describe(`tool path traversal — current symlink behavior`, () => {
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

  it(`read: ".." escape is rejected by the prefix check`, async () => {
    const tool = createReadFileTool(cwd)
    const result = await tool.execute(`r-dotdot`, { path: `../escape.txt` })
    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
  })

  it(`read: symlink inside cwd pointing outside currently succeeds`, async () => {
    const secret = join(outside, `secret.txt`)
    await writeFile(secret, `secret data`, `utf-8`)
    await symlink(secret, join(cwd, `link.txt`))
    const tool = createReadFileTool(cwd)
    const result = await tool.execute(`r-link`, { path: `link.txt` })
    expect((result.content[0] as { text: string }).text).toBe(`secret data`)
  })

  it(`write: ".." escape is rejected by the prefix check`, async () => {
    const tool = createWriteTool(cwd)
    const result = await tool.execute(`w-dotdot`, {
      path: `../escape.txt`,
      content: `nope`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
  })

  it(`write: symlink inside cwd pointing outside currently clobbers the target`, async () => {
    const target = join(outside, `target.txt`)
    await writeFile(target, `original`, `utf-8`)
    await symlink(target, join(cwd, `link.txt`))
    const tool = createWriteTool(cwd)
    const result = await tool.execute(`w-link`, {
      path: `link.txt`,
      content: `clobbered`,
    })
    expect(result.details).toMatchObject({ bytesWritten: 9 })
    expect(await readFile(target, `utf-8`)).toBe(`clobbered`)
  })

  it(`edit: ".." escape is rejected by the prefix check`, async () => {
    const tool = createEditTool(cwd, new Set())
    const result = await tool.execute(`e-dotdot`, {
      path: `../escape.txt`,
      old_string: `a`,
      new_string: `b`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
  })

  it(`edit: symlink inside cwd pointing outside currently edits through the link`, async () => {
    const target = join(outside, `t.txt`)
    await writeFile(target, `hello world`, `utf-8`)
    const linkPath = join(cwd, `link.txt`)
    await symlink(target, linkPath)
    // The edit tool requires the file to be in readSet; populate it with the
    // resolved path the tool would compute. This mirrors what read would have
    // done in the same session.
    const tool = createEditTool(cwd, new Set([linkPath]))
    const result = await tool.execute(`e-link`, {
      path: `link.txt`,
      old_string: `world`,
      new_string: `there`,
    })
    expect(result.details).toMatchObject({ replacements: 1 })
    expect(await readFile(target, `utf-8`)).toBe(`hello there`)
  })
})
