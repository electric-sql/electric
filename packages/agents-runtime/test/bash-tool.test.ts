import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBashTool } from '../src/tools/bash'

describe(`bash tool`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `bash-tool-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`runs commands in the working directory without overriding HOME`, async () => {
    const tool = createBashTool(cwd)
    const result = await tool.execute(`call-1`, {
      command: `node -e "console.log(process.cwd()); console.log(process.env.HOME)"`,
    })

    expect(result.details).toMatchObject({ exitCode: 0, timedOut: false })
    const lines = (result.content[0] as { text: string }).text
      .trim()
      .split(`\n`)
    expect(lines).toEqual([await realpath(cwd), process.env.HOME ?? homedir()])
  })
})
