import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWriteTool } from '../src/electric-agents/tools/write'

describe(`write tool`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `write-tool-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`writes a new file and updates the readSet`, async () => {
    const readSet = new Set<string>()
    const tool = createWriteTool(cwd, readSet)
    const result = await tool.execute(`call-1`, {
      path: `hello.txt`,
      content: `hi there`,
    })
    expect(result.content[0]).toMatchObject({ type: `text` })
    const written = await readFile(join(cwd, `hello.txt`), `utf-8`)
    expect(written).toBe(`hi there`)
    expect(readSet.has(join(cwd, `hello.txt`))).toBe(true)
  })

  it(`creates parent directories as needed`, async () => {
    const tool = createWriteTool(cwd)
    await tool.execute(`call-2`, {
      path: `nested/dir/file.txt`,
      content: `nested content`,
    })
    const written = await readFile(join(cwd, `nested/dir/file.txt`), `utf-8`)
    expect(written).toBe(`nested content`)
  })

  it(`overwrites existing files`, async () => {
    const tool = createWriteTool(cwd)
    await tool.execute(`a`, { path: `f.txt`, content: `first` })
    await tool.execute(`b`, { path: `f.txt`, content: `second` })
    expect(await readFile(join(cwd, `f.txt`), `utf-8`)).toBe(`second`)
  })

  it(`rejects paths that escape the working directory`, async () => {
    const tool = createWriteTool(cwd)
    const result = await tool.execute(`x`, {
      path: `../escape.txt`,
      content: `nope`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
  })
})
