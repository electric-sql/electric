import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSkillsRegistry } from '../src/skills/registry'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `skills-test-`))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeSkill(dir: string, name: string, content: string) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${name}.md`), content, `utf-8`)
}

const FULL_PREAMBLE = `---
description: Test skill
whenToUse: When testing
keywords: [test, example]
---

# Test Skill Content`

describe(`createSkillsRegistry`, () => {
  it(`scans a single directory and builds catalog`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)

    const registry = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    expect(registry.catalog.size).toBe(1)
    const alpha = registry.catalog.get(`alpha`)
    expect(alpha).toBeDefined()
    expect(alpha!.description).toBe(`Test skill`)
    expect(alpha!.keywords).toEqual([`test`, `example`])
  })

  it(`app skills override base skills with same name`, async () => {
    const baseDir = path.join(tmpDir, `base-skills`)
    const appDir = path.join(tmpDir, `app-skills`)

    await writeSkill(
      baseDir,
      `tutorial`,
      `---
description: Base tutorial
whenToUse: Base scenario
keywords: [base]
---
# Base`
    )

    await writeSkill(
      appDir,
      `tutorial`,
      `---
description: App tutorial
whenToUse: App scenario
keywords: [app]
---
# App`
    )

    const registry = await createSkillsRegistry({
      baseSkillsDir: baseDir,
      appSkillsDir: appDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    expect(registry.catalog.size).toBe(1)
    expect(registry.catalog.get(`tutorial`)!.description).toBe(`App tutorial`)
    expect(registry.catalog.get(`tutorial`)!.source).toContain(`app-skills`)
  })

  it(`merges skills from both directories`, async () => {
    const baseDir = path.join(tmpDir, `base-skills`)
    const appDir = path.join(tmpDir, `app-skills`)

    await writeSkill(baseDir, `tutorial`, FULL_PREAMBLE)
    await writeSkill(appDir, `deployment`, FULL_PREAMBLE)

    const registry = await createSkillsRegistry({
      baseSkillsDir: baseDir,
      appSkillsDir: appDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    expect(registry.catalog.size).toBe(2)
    expect(registry.catalog.has(`tutorial`)).toBe(true)
    expect(registry.catalog.has(`deployment`)).toBe(true)
  })

  it(`readContent returns file content`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)

    const registry = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    const content = await registry.readContent(`alpha`)
    expect(content).toBe(FULL_PREAMBLE)
  })

  it(`readContent returns null for unknown skill`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)

    const registry = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    const content = await registry.readContent(`nonexistent`)
    expect(content).toBeNull()
  })

  it(`renderCatalog formats all skills`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)

    const registry = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    const catalog = registry.renderCatalog()
    expect(catalog).toContain(`alpha`)
    expect(catalog).toContain(`Test skill`)
    expect(catalog).toContain(`When testing`)
    expect(catalog).toContain(`test, example`)
  })

  it(`renderCatalog progressively truncates when over budget`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    // Create several skills to generate a large catalog
    for (let i = 0; i < 10; i++) {
      await writeSkill(
        skillsDir,
        `skill-${i}`,
        `---
description: This is a fairly long description for skill number ${i} that takes up space
whenToUse: When the user needs to do something related to skill ${i}
keywords: [keyword-a-${i}, keyword-b-${i}, keyword-c-${i}]
---
# Skill ${i}`
      )
    }

    const registry = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    // No budget — full detail
    const full = registry.renderCatalog()
    expect(full).toContain(`Keywords:`)

    // Tight budget — should drop keywords (compact mode)
    const compact = registry.renderCatalog(1200)
    expect(compact.length).toBeLessThanOrEqual(1200)
    expect(compact).not.toContain(`Keywords:`)

    // Very tight budget — names only
    const names = registry.renderCatalog(800)
    expect(names.length).toBeLessThanOrEqual(800)
    expect(names).not.toContain(`Use when:`)
  })

  it(`uses cache on second load when file unchanged`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    const cacheDir = path.join(tmpDir, `.electric-agents`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)

    await createSkillsRegistry({ baseSkillsDir: skillsDir, cacheDir })

    const cacheFile = path.join(cacheDir, `skills-cache.json`)
    const cacheContent = await fs.readFile(cacheFile, `utf-8`)
    const cache = JSON.parse(cacheContent)
    expect(cache.alpha).toBeDefined()
    expect(cache.alpha.contentHash).toBeDefined()

    const registry2 = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir,
    })
    expect(registry2.catalog.get(`alpha`)!.description).toBe(`Test skill`)
  })

  it(`re-extracts when file content changes`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    const cacheDir = path.join(tmpDir, `.electric-agents`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)

    await createSkillsRegistry({ baseSkillsDir: skillsDir, cacheDir })

    await writeSkill(
      skillsDir,
      `alpha`,
      `---
description: Updated skill
whenToUse: Updated scenario
keywords: [updated]
---
# Updated`
    )

    const registry2 = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir,
    })
    expect(registry2.catalog.get(`alpha`)!.description).toBe(`Updated skill`)
  })

  it(`removes stale cache entries`, async () => {
    const skillsDir = path.join(tmpDir, `skills`)
    const cacheDir = path.join(tmpDir, `.electric-agents`)
    await writeSkill(skillsDir, `alpha`, FULL_PREAMBLE)
    await writeSkill(skillsDir, `beta`, FULL_PREAMBLE)

    await createSkillsRegistry({ baseSkillsDir: skillsDir, cacheDir })

    await fs.rm(path.join(skillsDir, `beta.md`))

    const registry2 = await createSkillsRegistry({
      baseSkillsDir: skillsDir,
      cacheDir,
    })
    expect(registry2.catalog.size).toBe(1)
    expect(registry2.catalog.has(`beta`)).toBe(false)

    const cacheContent = await fs.readFile(
      path.join(cacheDir, `skills-cache.json`),
      `utf-8`
    )
    const cache = JSON.parse(cacheContent)
    expect(cache.beta).toBeUndefined()
  })

  it(`handles missing skills directories gracefully`, async () => {
    const registry = await createSkillsRegistry({
      baseSkillsDir: path.join(tmpDir, `nonexistent-base`),
      appSkillsDir: path.join(tmpDir, `nonexistent-app`),
      cacheDir: path.join(tmpDir, `.electric-agents`),
    })

    expect(registry.catalog.size).toBe(0)
  })
})
