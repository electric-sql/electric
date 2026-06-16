import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { createReadFileTool } from '../src/tools/read-file'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

function firstText(result: {
  content: Array<{ type: string; text?: string }>
}) {
  const block = result.content[0]
  return block?.type === `text` ? (block.text ?? ``) : ``
}

async function withTempSandbox<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `read-file-tool-`))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe(`read file tool`, () => {
  test(`defaults to a line-numbered bounded preview with continuation guidance`, async () => {
    await withTempSandbox(async (dir) => {
      await writeFile(
        join(dir, `long.txt`),
        Array.from({ length: 2105 }, (_, i) => `line ${i + 1}`).join(`\n`)
      )
      const sandbox = await unrestrictedSandbox({ workingDirectory: dir })
      try {
        const tool = createReadFileTool(sandbox)
        const result = await tool.execute(`test`, { path: `long.txt` })
        const text = firstText(result)

        expect(text).toContain(`<path>long.txt</path>`)
        expect(text).toContain(`1: line 1`)
        expect(text).toContain(`2000: line 2000`)
        expect(text).not.toContain(`2001: line 2001`)
        expect(text).toContain(`Use offset=2001 to continue`)
        expect(result.details.truncated).toBe(true)
        expect(result.details.startLine).toBe(1)
        expect(result.details.endLine).toBe(2000)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  test(`reads from offset with limit`, async () => {
    await withTempSandbox(async (dir) => {
      await writeFile(
        join(dir, `window.txt`),
        Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(`\n`)
      )
      const sandbox = await unrestrictedSandbox({ workingDirectory: dir })
      try {
        const tool = createReadFileTool(sandbox)
        const result = await tool.execute(`test`, {
          path: `window.txt`,
          offset: 10,
          limit: 3,
        })
        const text = firstText(result)

        expect(text).toContain(`10: line 10`)
        expect(text).toContain(`12: line 12`)
        expect(text).not.toContain(`9: line 9`)
        expect(text).not.toContain(`13: line 13`)
        expect(text).toContain(`Use offset=13 to continue`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  test(`caps output by bytes and truncates very long lines`, async () => {
    await withTempSandbox(async (dir) => {
      await writeFile(
        join(dir, `wide.txt`),
        [
          `a`.repeat(3000),
          ...Array.from({ length: 100 }, () => `b`.repeat(1000)),
        ].join(`\n`)
      )
      const sandbox = await unrestrictedSandbox({ workingDirectory: dir })
      try {
        const tool = createReadFileTool(sandbox)
        const result = await tool.execute(`test`, { path: `wide.txt` })
        const text = firstText(result)

        expect(text).toContain(`line truncated to 2000 chars`)
        expect(text).toContain(`Output capped at 50 KB`)
        expect(result.details.truncated).toBe(true)
        expect(result.details.shownBytes).toBeLessThanOrEqual(50 * 1024)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  test(`handles empty files and trailing newlines consistently`, async () => {
    await withTempSandbox(async (dir) => {
      await writeFile(join(dir, `empty.txt`), ``)
      await writeFile(join(dir, `newline.txt`), `payload\n`)
      const sandbox = await unrestrictedSandbox({ workingDirectory: dir })
      try {
        const tool = createReadFileTool(sandbox)
        const empty = await tool.execute(`test`, { path: `empty.txt` })
        expect(firstText(empty)).toContain(`(Empty file)`)
        expect(empty.details.startLine).toBe(0)
        expect(empty.details.endLine).toBe(0)
        expect(empty.details.totalLines).toBe(0)

        const newline = await tool.execute(`test`, { path: `newline.txt` })
        expect(firstText(newline)).toContain(`(End of file - total 1 lines)`)
        expect(newline.details.totalLines).toBe(1)
      } finally {
        await sandbox.dispose()
      }
    })
  })
})
