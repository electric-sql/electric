import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../../agents/src/tools/edit'
import { createReadFileTool } from '../../agents/src/tools/read-file'

describe(`readSet isolation across handler invocations`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `readset-iso-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`entity A's read does not satisfy entity B's edit guard`, async () => {
    await writeFile(join(cwd, `shared.txt`), `aaa bbb`, `utf-8`)

    const readSetA = new Set<string>()
    const readA = createReadFileTool(cwd, readSetA)
    await readA.execute(`a`, { path: `shared.txt` })

    const readSetB = new Set<string>()
    const editB = createEditTool(cwd, readSetB)
    const result = await editB.execute(`b`, {
      path: `shared.txt`,
      old_string: `aaa`,
      new_string: `xxx`,
    })

    expect((result.content[0] as { text: string }).text).toMatch(
      /has not been read in this session/
    )
  })
})
