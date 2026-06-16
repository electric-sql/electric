import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

describe(`edit tool`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `edit-tool-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`edits a file without requiring a prior read`, async () => {
    await writeFile(join(cwd, `f.txt`), `hello world`, `utf-8`)
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const edit = createEditTool(sandbox)
    const result = await edit.execute(`call`, {
      path: `f.txt`,
      old_string: `world`,
      new_string: `there`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(/Edited/)
    expect((await sandbox.readFile(`f.txt`)).toString(`utf-8`)).toBe(
      `hello there`
    )
    await sandbox.dispose()
  })

  it(`does not depend on readSet contents`, async () => {
    await writeFile(join(cwd, `g.txt`), `aaa bbb`, `utf-8`)
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const edit = createEditTool(sandbox)
    const result = await edit.execute(`e`, {
      path: `g.txt`,
      old_string: `aaa`,
      new_string: `xxx`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(/Edited/)
    await sandbox.dispose()
  })

  it(`requires unique old_string when replace_all is false`, async () => {
    await writeFile(join(cwd, `dup.txt`), `foo foo`, `utf-8`)
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const edit = createEditTool(sandbox)
    const result = await edit.execute(`e`, {
      path: `dup.txt`,
      old_string: `foo`,
      new_string: `bar`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /found 2 matches/
    )
    await sandbox.dispose()
  })

  it(`replaces all occurrences when replace_all is true`, async () => {
    await writeFile(join(cwd, `multi.txt`), `aa bb aa cc aa`, `utf-8`)
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const edit = createEditTool(sandbox)
    const result = await edit.execute(`e`, {
      path: `multi.txt`,
      old_string: `aa`,
      new_string: `ZZ`,
      replace_all: true,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /3 occurrences|3 replacements/
    )
    await sandbox.dispose()
  })
})
