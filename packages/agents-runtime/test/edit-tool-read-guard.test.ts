import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { createReadFileTool } from '../src/tools/read-file'

describe(`edit tool read-first guard`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `edit-guard-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`rejects edit if the file was not read in this session`, async () => {
    await writeFile(join(cwd, `f.txt`), `hello world`, `utf-8`)
    const readSet = new Set<string>()
    const edit = createEditTool(cwd, readSet)
    const result = await edit.execute(`call`, {
      path: `f.txt`,
      old_string: `world`,
      new_string: `there`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /has not been read in this session/
    )
  })

  it(`allows edit after a read in the same session`, async () => {
    await writeFile(join(cwd, `f.txt`), `hello world`, `utf-8`)
    const readSet = new Set<string>()
    const read = createReadFileTool(cwd, readSet)
    const edit = createEditTool(cwd, readSet)

    await read.execute(`r`, { path: `f.txt` })
    const result = await edit.execute(`e`, {
      path: `f.txt`,
      old_string: `world`,
      new_string: `there`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /Edited|Replaced/
    )
  })

  it(`rejects edit across a wake boundary (fresh readSet)`, async () => {
    await writeFile(join(cwd, `g.txt`), `aaa bbb`, `utf-8`)

    const wake1ReadSet = new Set<string>()
    const wake1Read = createReadFileTool(cwd, wake1ReadSet)
    const wake1Edit = createEditTool(cwd, wake1ReadSet)
    await wake1Read.execute(`r1`, { path: `g.txt` })
    const editResult1 = await wake1Edit.execute(`e1`, {
      path: `g.txt`,
      old_string: `aaa`,
      new_string: `xxx`,
    })
    expect((editResult1.content[0] as { text: string }).text).toMatch(
      /Edited|Replaced/
    )

    const wake2ReadSet = new Set<string>()
    const wake2Edit = createEditTool(cwd, wake2ReadSet)
    const editResult2 = await wake2Edit.execute(`e2`, {
      path: `g.txt`,
      old_string: `xxx`,
      new_string: `yyy`,
    })
    expect((editResult2.content[0] as { text: string }).text).toMatch(
      /has not been read in this session/
    )
  })

  it(`requires unique old_string when replace_all is false`, async () => {
    await writeFile(join(cwd, `dup.txt`), `foo foo`, `utf-8`)
    const readSet = new Set<string>()
    const read = createReadFileTool(cwd, readSet)
    const edit = createEditTool(cwd, readSet)
    await read.execute(`r`, { path: `dup.txt` })
    const result = await edit.execute(`e`, {
      path: `dup.txt`,
      old_string: `foo`,
      new_string: `bar`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /found 2 matches/
    )
  })

  it(`replaces all occurrences when replace_all is true`, async () => {
    await writeFile(join(cwd, `multi.txt`), `aa bb aa cc aa`, `utf-8`)
    const readSet = new Set<string>()
    const read = createReadFileTool(cwd, readSet)
    const edit = createEditTool(cwd, readSet)
    await read.execute(`r`, { path: `multi.txt` })
    const result = await edit.execute(`e`, {
      path: `multi.txt`,
      old_string: `aa`,
      new_string: `ZZ`,
      replace_all: true,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /3 occurrences|3 replacements/
    )
  })
})
