import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrManager } from '../src/agents/pr-manager'
import { createBuiltinModelCatalog } from '../src/model-catalog'

function makeBoardMocks() {
  return {
    pr_meta: {
      toArray: [
        {
          key: `meta`,
          number: 42,
          repo: `foo/bar`,
          title: `t`,
          base_branch: `main`,
          base_sha: `B`,
          head_branch: `feat`,
          head_sha: `A`,
          description: ``,
          state: `open`,
          labels: [`agents`],
          mergeable: true,
          status_comment_id: null,
          agents_disabled: false,
          last_synced_at: `2026-05-08T00:00:00Z`,
        },
      ],
      update: vi.fn((_k, fn) => fn({})),
      insert: vi.fn(),
    },
    signals: { insert: vi.fn(), toArray: [], update: vi.fn() },
    checks: {
      toArray: [],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    review_threads: { toArray: [], insert: vi.fn() },
    doc_plan: { toArray: [], insert: vi.fn() },
    commits: { toArray: [], insert: vi.fn() },
    gates: { toArray: [], insert: vi.fn(), update: vi.fn() },
    agent_state: { toArray: [], insert: vi.fn(), update: vi.fn() },
  } as any
}

function makeCtx(over: Partial<Record<string, unknown>>) {
  return {
    entityType: `pr-manager`,
    entityUrl: `http://x/pr-manager/1/main`,
    args: {},
    firstWake: false,
    events: [],
    observe: vi.fn(),
    spawn: vi.fn(),
    send: vi.fn(),
    useAgent: vi.fn(),
    agent: { run: vi.fn() },
    useContext: vi.fn(),
    timelineMessages: () => [],
    setTag: vi.fn(),
    db: { collections: { inbox: { toArray: [] } } } as any,
    ...over,
  } as any
}

describe(`pr-manager`, () => {
  it(`registers a "pr-manager" entity type`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrManager(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    expect(registry.get(`pr-manager`)).toBeDefined()
  })

  it(`on firstWake, observes the per-PR blackboard, spawns three workers, schedules sync tick`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const createWorktree = vi.fn().mockResolvedValue(`/tmp/.worktrees/pr-42`)
    const fetchPr = vi.fn().mockResolvedValue({
      number: 42,
      title: `t`,
      state: `open`,
      mergeable: true,
      head: { sha: `A`, ref: `feat` },
      base: { sha: `B`, ref: `main` },
      body: ``,
      labels: [`agents`],
    })
    registerPrManager(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
      createWorktree,
      githubFactory: () =>
        ({
          fetchPr,
          fetchChecks: vi.fn().mockResolvedValue([]),
          fetchCommentsSince: vi.fn().mockResolvedValue([]),
          upsertComment: vi.fn().mockResolvedValue(`cmt-1`),
          addLabel: vi.fn(),
          removeLabel: vi.fn(),
        }) as any,
    })

    const board = makeBoardMocks()
    const observe = vi.fn().mockResolvedValue(board)
    const spawn = vi.fn().mockResolvedValue({ entityUrl: `u` })
    const send = vi.fn()
    const ctx = makeCtx({
      args: {
        repo: `foo/bar`,
        number: 42,
        head_branch: `feat`,
        worktreeRoot: `/tmp/.worktrees`,
      },
      firstWake: true,
      observe,
      spawn,
      send,
    })
    await registry.get(`pr-manager`)!.definition.handler(ctx as any, {} as any)

    expect(createWorktree).toHaveBeenCalledWith({
      repoRoot: `/tmp`,
      prNumber: 42,
      headBranch: `feat`,
    })
    const spawned = spawn.mock.calls.map((c) => c[0])
    expect(spawned).toEqual(
      expect.arrayContaining([
        `pr-reviewer`,
        `pr-build-doctor`,
        `pr-doc-editor`,
      ])
    )
    expect(send).toHaveBeenCalledWith(
      ctx.entityUrl,
      expect.objectContaining({ kind: `sync_tick` }),
      expect.objectContaining({ afterMs: 30_000 })
    )
  })

  it(`on wake with payload.kind === "sync_tick", runs runSyncPoll then schedules next tick`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const fetchPr = vi.fn().mockResolvedValue({
      number: 42,
      title: `t`,
      state: `open`,
      mergeable: true,
      head: { sha: `A`, ref: `feat` },
      base: { sha: `B`, ref: `main` },
      body: ``,
      labels: [`agents`],
    })
    registerPrManager(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
      createWorktree: vi.fn(),
      githubFactory: () =>
        ({
          fetchPr,
          fetchChecks: vi.fn().mockResolvedValue([]),
          fetchCommentsSince: vi.fn().mockResolvedValue([]),
          upsertComment: vi.fn(),
          addLabel: vi.fn(),
          removeLabel: vi.fn(),
        }) as any,
    })
    const board = makeBoardMocks()
    const observe = vi.fn().mockResolvedValue(board)
    const send = vi.fn()
    const ctx = makeCtx({
      args: {
        repo: `foo/bar`,
        number: 42,
        head_branch: `feat`,
        worktreeRoot: `/tmp/.worktrees`,
      },
      firstWake: false,
      events: [
        {
          type: `inbox.user_message`,
          value: { content: JSON.stringify({ kind: `sync_tick` }) },
        },
      ],
      observe,
      spawn: vi.fn(),
      send,
    })
    await registry.get(`pr-manager`)!.definition.handler(ctx as any, {} as any)
    expect(fetchPr).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      ctx.entityUrl,
      expect.objectContaining({ kind: `sync_tick` }),
      expect.any(Object)
    )
  })
})
