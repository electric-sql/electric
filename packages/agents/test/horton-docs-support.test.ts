import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHortonDocsSupport } from '../src/docs/knowledge-base'

const tempDirs = new Set<string>()

async function makeTempDocsFixture(): Promise<{
  workdir: string
  root: string
  dbPath: string
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `horton-docs-`))
  tempDirs.add(root)

  const docsRoot = path.join(root, `docs`)
  await fs.mkdir(path.join(docsRoot, `usage`), { recursive: true })
  await fs.mkdir(path.join(docsRoot, `reference`), { recursive: true })

  await fs.writeFile(
    path.join(docsRoot, `usage`, `testing.md`),
    `---
title: Testing
---

# Testing

## testResponses

Use testResponses to stub agent output in tests.
`,
    `utf8`
  )

  await fs.writeFile(
    path.join(docsRoot, `reference`, `wake-event.md`),
    `# Wake Event

## Fields

WakeEvent includes source, type, payload, fromOffset, toOffset, and eventCount.
`,
    `utf8`
  )

  return {
    workdir: root,
    root: docsRoot,
    dbPath: path.join(root, `.electric-agents`, `horton-docs.sqlite`),
  }
}

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
      tempDirs.delete(dir)
    })
  )
})

describe(`horton docs support`, () => {
  it(`renders a compressed TOC and returns hybrid search results`, async () => {
    const fixture = await makeTempDocsFixture()
    const support = createHortonDocsSupport(fixture.workdir, {
      docsRoot: fixture.root,
      dbPath: fixture.dbPath,
    })

    expect(support).not.toBeNull()
    await support!.ensureReady()

    const toc = await support!.renderCompressedToc()
    expect(toc).toContain(`${fixture.root}/usage/testing.md`)
    expect(toc).toContain(`testResponses`)
    expect(toc).toContain(`${fixture.root}/reference/wake-event.md`)

    const result = await support!.createSearchTool().execute(`tool-1`, {
      query: `How do I test handlers with testResponses?`,
      limit: 3,
    })
    const text =
      result.content[0]?.type === `text` ? result.content[0].text : ``
    expect(text).toContain(`<docs_search`)
    expect(text).toContain(`${fixture.root}/usage/testing.md`)
    expect(text).toContain(`testResponses`)
  })
})
