import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditTool } from '../src/tools/edit'
import { createReadFileTool } from '../src/tools/read-file'
import { createWriteTool } from '../src/tools/write'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

describe(`tools refuse symlink-based escape from the working directory`, () => {
  let cwd: string
  let outside: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `sandbox-symlink-cwd-`))
    outside = await mkdtemp(join(tmpdir(), `sandbox-symlink-outside-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it(`read rejects a symlink pointing outside the working directory`, async () => {
    await writeFile(join(outside, `secret.txt`), `s3cret`, `utf-8`)
    await symlink(join(outside, `secret.txt`), join(cwd, `link.txt`))

    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const tool = createReadFileTool(sandbox)
    const result = await tool.execute(`r`, { path: `link.txt` })

    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
    await sandbox.dispose()
  })

  it(`edit rejects a symlink pointing outside the working directory`, async () => {
    await writeFile(join(outside, `victim.txt`), `untouched`, `utf-8`)
    await symlink(join(outside, `victim.txt`), join(cwd, `link.txt`))

    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const tool = createEditTool(sandbox)
    const result = await tool.execute(`e`, {
      path: `link.txt`,
      old_string: `untouched`,
      new_string: `hijacked`,
    })

    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
    await sandbox.dispose()
  })

  it(`write rejects a path whose parent is a symlink to outside the working directory`, async () => {
    await mkdir(join(outside, `target-dir`))
    await symlink(join(outside, `target-dir`), join(cwd, `linked-dir`))

    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    const tool = createWriteTool(sandbox)
    const result = await tool.execute(`w`, {
      path: `linked-dir/leaked.txt`,
      content: `should not land outside`,
    })

    expect((result.content[0] as { text: string }).text).toMatch(
      /outside the working directory/
    )
    await sandbox.dispose()
  })
})
