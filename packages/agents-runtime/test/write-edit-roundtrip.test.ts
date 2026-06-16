import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { createWriteTool } from '../src/tools/write'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

describe(`write→edit roundtrip in same wake`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `write-edit-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`edit succeeds on a freshly-written file`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const readSet = new Set<string>()
    const write = createWriteTool(sandbox, readSet)
    const edit = createEditTool(sandbox)

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
    await sandbox.dispose()
  })
})
