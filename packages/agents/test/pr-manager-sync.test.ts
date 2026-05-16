import { describe, expect, it, vi } from 'vitest'
import { runSyncPoll } from '../src/agents/pr-manager'

describe(`runSyncPoll`, () => {
  const baseMeta = {
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
  }
  const insert = vi.fn()
  const update = vi.fn((_k, fn) => fn(JSON.parse(JSON.stringify(baseMeta))))

  it(`inserts head_sha_changed when remote head sha differs`, async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi.fn().mockResolvedValue({
        ...baseMeta,
        head: { sha: `A2`, ref: `feat` },
        base: { sha: `B`, ref: `main` },
        body: ``,
        labels: [`agents`],
        state: `open`,
        mergeable: true,
        title: `t`,
        number: 42,
      }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: `foo/bar`,
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: `head_sha_changed` })
    )
  })

  it(`inserts ci_failed when any check has conclusion=failure`, async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi.fn().mockResolvedValue({
        ...baseMeta,
        head: { sha: `A`, ref: `feat` },
        base: { sha: `B`, ref: `main` },
        body: ``,
        labels: [`agents`],
        state: `open`,
        mergeable: true,
        title: `t`,
        number: 42,
      }),
      fetchChecks: vi.fn().mockResolvedValue([
        {
          key: `lint@A`,
          name: `lint`,
          status: `completed`,
          conclusion: `failure`,
          log_url: `u`,
          head_sha: `A`,
        },
      ]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: `foo/bar`,
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: `ci_failed`,
        payload: expect.objectContaining({ failed_checks: [`lint`] }),
      })
    )
  })

  it(`inserts new_human_comment + slash command effects`, async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi.fn().mockResolvedValue({
        ...baseMeta,
        head: { sha: `A`, ref: `feat` },
        base: { sha: `B`, ref: `main` },
        body: ``,
        labels: [`agents`],
        state: `open`,
        mergeable: true,
        title: `t`,
        number: 42,
      }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi.fn().mockResolvedValue([
        {
          id: `c1`,
          user: { login: `human` },
          body: `/stop`,
          created_at: `2026-05-09T00:00:00Z`,
        },
      ]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: `foo/bar`,
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: `new_human_comment` })
    )
    expect(meta.update).toHaveBeenCalled()
  })

  it(`inserts agents_label_removed when agents label disappears`, async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi.fn().mockResolvedValue({
        ...baseMeta,
        head: { sha: `A`, ref: `feat` },
        base: { sha: `B`, ref: `main` },
        body: ``,
        labels: [],
        state: `open`,
        mergeable: true,
        title: `t`,
        number: 42,
      }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: `foo/bar`,
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: `agents_label_removed` })
    )
  })
})
