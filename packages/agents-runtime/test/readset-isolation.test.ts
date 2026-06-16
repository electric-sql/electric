import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

describe(`edit tool without readSet guard`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `readset-iso-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`does not require readSet state from the current handler invocation`, async () => {
    await writeFile(join(cwd, `shared.txt`), `aaa bbb`, `utf-8`)
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })

    const edit = createEditTool(sandbox)
    const result = await edit.execute(`b`, {
      path: `shared.txt`,
      old_string: `aaa`,
      new_string: `xxx`,
    })

    expect((result.content[0] as { text: string }).text).toMatch(/Edited/)
    expect((await sandbox.readFile(`shared.txt`)).toString(`utf-8`)).toBe(
      `xxx bbb`
    )
    await sandbox.dispose()
  })
})
