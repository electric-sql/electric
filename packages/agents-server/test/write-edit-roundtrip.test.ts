import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../../agents/src/tools/edit'
import { createWriteTool } from '../../agents/src/tools/write'

describe(`write→edit roundtrip in same wake`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `write-edit-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`edit succeeds on a freshly-written file (write populates readSet)`, async () => {
    const readSet = new Set<string>()
    const write = createWriteTool(cwd, readSet)
    const edit = createEditTool(cwd, readSet)

    await write.execute(`w`, {
      path: `r.txt`,
      content: `original content`,
    })
    const editResult = await edit.execute(`e`, {
      path: `r.txt`,
      old_string: `original`,
      new_string: `modified`,
    })
    expect((editResult.content[0] as { text: string }).text).toMatch(
      /Edited|Replaced/
    )
    expect(await readFile(join(cwd, `r.txt`), `utf-8`)).toBe(`modified content`)
  })
})
