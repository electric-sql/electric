import { describe, expect, it, vi } from 'vitest'
import { createSkillTools } from '../src/skills/tools'
import type { SkillMeta, SkillsRegistry } from '../src/skills/types'

function createMockRegistry(
  skills: Record<string, { meta: SkillMeta; content: string }>
): SkillsRegistry {
  const catalog = new Map<string, SkillMeta>()
  for (const [name, { meta }] of Object.entries(skills)) {
    catalog.set(name, meta)
  }
  return {
    catalog,
    renderCatalog: () => `mock catalog`,
    readContent: async (name: string) => skills[name]?.content ?? null,
  }
}

function createMockCtx() {
  const inserted = new Map<string, { name: string; content: string }>()
  const removed = new Set<string>()
  return {
    insertContext: vi.fn(
      (id: string, entry: { name: string; content: string }) => {
        inserted.set(id, entry)
      }
    ),
    removeContext: vi.fn((id: string) => {
      removed.add(id)
    }),
    getContext: vi.fn((id: string) => (inserted.has(id) ? { id } : undefined)),
    _inserted: inserted,
    _removed: removed,
  }
}

const TUTORIAL_META: SkillMeta = {
  name: `tutorial`,
  description: `A tutorial`,
  whenToUse: `When learning`,
  keywords: [`tutorial`],
  max: 10_000,
  charCount: 500,
  contentHash: `abc123`,
  source: `/skills/tutorial.md`,
}

describe(`skill tools`, () => {
  it(`use_skill loads skill content into context`, async () => {
    const registry = createMockRegistry({
      tutorial: { meta: TUTORIAL_META, content: `# Tutorial\nContent here` },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    const result = await useTool.execute(`tc1`, { name: `tutorial` })

    expect(ctx.insertContext).toHaveBeenCalledWith(
      `skill:tutorial`,
      expect.objectContaining({
        name: `skill_instructions`,
        attrs: { skill: `tutorial`, type: `directive` },
      })
    )
    const insertedContent = ctx.insertContext.mock.calls[0]![1].content
    expect(insertedContent).toContain(`# Tutorial\nContent here`)
    // Tool result contains the full skill content
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`SKILL ACTIVATED`),
    })
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`# Tutorial\nContent here`),
    })
  })

  it(`use_skill returns error for unknown skill`, async () => {
    const registry = createMockRegistry({})
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    const result = await useTool.execute(`tc1`, { name: `nonexistent` })

    expect(ctx.insertContext).not.toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`not found`),
    })
  })

  it(`use_skill is a no-op when skill is already loaded`, async () => {
    const registry = createMockRegistry({
      tutorial: { meta: TUTORIAL_META, content: `# Tutorial` },
    })
    const ctx = createMockCtx()
    ctx.getContext.mockReturnValue({ id: `skill:tutorial` })
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    const result = await useTool.execute(`tc1`, { name: `tutorial` })

    expect(ctx.insertContext).not.toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`already loaded`),
    })
  })

  it(`use_skill truncates and warns when content exceeds max`, async () => {
    const bigContent = `x`.repeat(15_000)
    const meta = { ...TUTORIAL_META, max: 10_000, charCount: 15_000 }
    const registry = createMockRegistry({
      tutorial: { meta, content: bigContent },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    const result = await useTool.execute(`tc1`, { name: `tutorial` })

    const insertedContent = ctx.insertContext.mock.calls[0]![1].content
    // Content is truncated to max (10,000) — no wrapper prefix in insertContext
    expect(insertedContent).toContain(`x`.repeat(100))
    expect(insertedContent.length).toBe(10_000)
    // Tool result contains truncation warning
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`truncated`),
    })
  })

  it(`remove_skill removes skill from context`, async () => {
    const registry = createMockRegistry({
      tutorial: { meta: TUTORIAL_META, content: `# Tutorial` },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const removeTool = tools.find((t) => t.name === `remove_skill`)!

    const result = await removeTool.execute(`tc1`, { name: `tutorial` })

    expect(ctx.removeContext).toHaveBeenCalledWith(`skill:tutorial`)
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`removed`),
    })
  })

  it(`use_skill substitutes named arguments`, async () => {
    const meta = {
      ...TUTORIAL_META,
      arguments: [`project_path`],
      argumentHint: `[project path]`,
    }
    const registry = createMockRegistry({
      tutorial: {
        meta,
        content: `Create project at $project_path`,
      },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    await useTool.execute(`tc1`, {
      name: `tutorial`,
      args: `/home/user/my-app`,
    })

    const insertedContent = ctx.insertContext.mock.calls[0]![1].content
    expect(insertedContent).toContain(`Create project at /home/user/my-app`)
    expect(insertedContent).not.toContain(`$project_path`)
  })

  it(`use_skill substitutes indexed arguments`, async () => {
    const registry = createMockRegistry({
      tutorial: {
        meta: TUTORIAL_META,
        content: `First: $0, Second: $1`,
      },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    await useTool.execute(`tc1`, { name: `tutorial`, args: `alpha beta` })

    const insertedContent = ctx.insertContext.mock.calls[0]![1].content
    expect(insertedContent).toContain(`First: alpha, Second: beta`)
  })

  it(`use_skill substitutes $ARGUMENTS`, async () => {
    const registry = createMockRegistry({
      tutorial: {
        meta: TUTORIAL_META,
        content: `Run with: $ARGUMENTS`,
      },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    await useTool.execute(`tc1`, { name: `tutorial`, args: `foo bar baz` })

    const insertedContent = ctx.insertContext.mock.calls[0]![1].content
    expect(insertedContent).toContain(`Run with: foo bar baz`)
  })

  it(`use_skill appends args when no placeholders found`, async () => {
    const registry = createMockRegistry({
      tutorial: {
        meta: TUTORIAL_META,
        content: `No placeholders here`,
      },
    })
    const ctx = createMockCtx()
    const tools = createSkillTools(registry, ctx as any)
    const useTool = tools.find((t) => t.name === `use_skill`)!

    await useTool.execute(`tc1`, { name: `tutorial`, args: `some-value` })

    const insertedContent = ctx.insertContext.mock.calls[0]![1].content
    expect(insertedContent).toContain(`No placeholders here`)
    expect(insertedContent).toContain(`Arguments: some-value`)
  })
})
