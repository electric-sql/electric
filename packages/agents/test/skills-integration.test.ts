import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSkillsRegistry } from '../src/skills/registry'
import { createSkillTools } from '../src/skills/tools'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `skills-e2e-`))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe(`skills end-to-end`, () => {
  it(`full lifecycle: scan -> catalog -> load -> unload`, async () => {
    const baseDir = path.join(tmpDir, `base-skills`)
    const appDir = path.join(tmpDir, `app-skills`)
    await fs.mkdir(baseDir, { recursive: true })
    await fs.mkdir(appDir, { recursive: true })

    await fs.writeFile(
      path.join(baseDir, `quickstart.md`),
      `---
description: Learn to build entities
whenToUse: User asks about quickstarts
keywords: [quickstart, learning]
---

# Tutorial

This is the quickstart content. It teaches you how to build entities.`,
      `utf-8`
    )

    await fs.writeFile(
      path.join(appDir, `my-guide.md`),
      `---
description: Custom app guide
whenToUse: User asks about the app
keywords: [guide, app]
---

# My Guide

App-specific content here.`,
      `utf-8`
    )

    // 1. Create registry
    const registry = await createSkillsRegistry({
      baseSkillsDir: baseDir,
      appSkillsDir: appDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    expect(registry.catalog.size).toBe(2)

    // 2. Check catalog rendering
    const catalog = registry.renderCatalog()
    expect(catalog).toContain(`quickstart`)
    expect(catalog).toContain(`my-guide`)

    // 3. Create skill tools with mock context
    const contextStore = new Map<string, { name: string; content: string }>()
    const mockCtx = {
      insertContext: vi.fn(
        (id: string, entry: { name: string; content: string }) => {
          contextStore.set(id, entry)
        }
      ),
      removeContext: vi.fn((id: string) => {
        contextStore.delete(id)
      }),
      getContext: vi.fn((id: string) => contextStore.get(id) ?? undefined),
    }

    const tools = createSkillTools(registry, mockCtx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!
    const removeTool = tools.find((t) => t.name === `remove_skill`)!

    // 4. Load a skill
    const loadResult = await useTool.execute(`tc1`, { name: `quickstart` })
    expect(loadResult.details).toMatchObject({ loaded: true })
    expect(contextStore.has(`skill:quickstart`)).toBe(true)
    expect(contextStore.get(`skill:quickstart`)!.content).toContain(`Tutorial`)

    // 5. Try loading again — should be no-op
    const dupResult = await useTool.execute(`tc2`, { name: `quickstart` })
    expect(dupResult.details).toMatchObject({ alreadyLoaded: true })

    // 6. Unload
    const removeResult = await removeTool.execute(`tc3`, { name: `quickstart` })
    expect(removeResult.details).toMatchObject({ removed: true })
    expect(mockCtx.removeContext).toHaveBeenCalledWith(`skill:quickstart`)
  })
})
