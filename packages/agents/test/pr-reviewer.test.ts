import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrReviewer } from '../src/agents/pr-reviewer'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe(`pr-reviewer`, () => {
  it(`registers a "pr-reviewer" entity type`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrReviewer(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    expect(registry.get(`pr-reviewer`)).toBeDefined()
  })

  it(`subscribes to the blackboard signals collection on wake`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrReviewer(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    const board = makeBoardWithSignal()
    const observe = vi.fn().mockResolvedValue(board)
    const useAgent = vi.fn()
    const ctx = makeWorkerCtx({ observe, useAgent })
    await registry.get(`pr-reviewer`)!.definition.handler(ctx, {} as any)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: `db`,
        sourceRef: `pr-foo/bar-42`,
      }),
      expect.objectContaining({
        wake: { on: `change`, collections: [`signals`] },
      })
    )
    expect(useAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(`reviewer`),
      })
    )
  })

  it(`passes bash/read/write/edit/fetch_url tools + sharedDb tools + skill loader`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrReviewer(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    const observe = vi.fn().mockResolvedValue(makeEmptyBoard())
    let captured: { tools?: unknown[] } | undefined
    const useAgent = vi.fn((cfg) => {
      captured = cfg
    })
    const ctx = makeWorkerCtx({ observe, useAgent, firstWake: true })
    await registry.get(`pr-reviewer`)!.definition.handler(ctx, {} as any)
    const toolNames = (captured!.tools as Array<{ name: string }>).map(
      (t) => t.name
    )
    expect(toolNames).toEqual(
      expect.arrayContaining([`bash`, `read`, `write`, `edit`, `fetch_url`])
    )
    expect(toolNames.some((n) => n.startsWith(`write_review_threads`))).toBe(
      true
    )
  })
})

function makeWorkerCtx(over: Partial<Record<string, unknown>>) {
  return {
    args: {
      repo: `foo/bar`,
      number: 42,
      head_branch: `feat`,
      base_branch: `main`,
      worktree_path: `/wt`,
      blackboard: { id: `pr-foo/bar-42` },
    },
    events: [],
    firstWake: false,
    entityUrl: `http://x`,
    entityType: `pr-reviewer`,
    observe: vi.fn(),
    spawn: vi.fn(),
    useAgent: vi.fn(),
    agent: { run: vi.fn() },
    timelineMessages: () => [],
    db: { collections: { inbox: { toArray: [] } } } as any,
    useContext: vi.fn(),
    insertContext: vi.fn(),
    removeContext: vi.fn(),
    getContext: vi.fn(),
    send: vi.fn(),
    setTag: vi.fn(),
    ...over,
  } as any
}

function makeBoardWithSignal() {
  return {
    pr_meta: { toArray: [{ key: `meta`, head_sha: `A` }] },
    signals: {
      toArray: [
        {
          key: `sig-1`,
          type: `head_sha_changed`,
          payload: {},
          ts: `now`,
          consumed_by: [],
        },
      ],
    },
    review_threads: {
      toArray: [],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    checks: { toArray: [], insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    doc_plan: {
      toArray: [],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    commits: { toArray: [], insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    gates: { toArray: [], insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    agent_state: {
      toArray: [],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as any
}

function makeEmptyBoard() {
  const empty = {
    toArray: [],
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  return {
    pr_meta: { ...empty, toArray: [] },
    signals: empty,
    review_threads: empty,
    checks: empty,
    doc_plan: empty,
    commits: empty,
    gates: empty,
    agent_state: empty,
  } as any
}
