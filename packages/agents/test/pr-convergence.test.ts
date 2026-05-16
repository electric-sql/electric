import { describe, expect, it, vi } from 'vitest'
import { runSyncPoll } from '../src/agents/pr-manager'
import { evalGates } from '../src/agents/pr-shared/gates'

describe(`PR convergence (offline)`, () => {
  it(`starts dirty (no checks, blank desc), flips to ready after sync brings green CI + valid template`, () => {
    const description = `## Summary\n\nadds X\n\n## Linked issues\n\ncloses #1\n\n## Test plan\n\n- [ ] verify`
    const meta = { description, mergeable: true }
    const checks = [
      { conclusion: `success` as const },
      { conclusion: `success` as const },
    ]
    const review_threads: Array<{
      severity: `must-fix` | `suggestion` | `nit`
      status: `open` | `addressed` | `wontfix`
    }> = []
    const doc_plan: Array<{ status: `done` | `needed` | `in-progress` }> = [
      { status: `done` },
    ]
    const g = evalGates({
      pr_meta: meta as any,
      checks,
      review_threads,
      doc_plan,
    })
    expect(g.ready_to_merge).toBe(true)
  })

  it(`runSyncPoll converts a remote head-sha change into a head_sha_changed signal`, async () => {
    const initialMeta = {
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
    const board = {
      pr_meta: {
        toArray: [initialMeta],
        update: vi.fn((_k, fn) => fn(JSON.parse(JSON.stringify(initialMeta)))),
        insert: vi.fn(),
      },
      signals: { insert: vi.fn(), toArray: [], update: vi.fn() },
      checks: {
        toArray: [],
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    } as any
    const gh = {
      fetchPr: vi
        .fn()
        .mockResolvedValue({
          ...initialMeta,
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
    } as any
    await runSyncPoll({ board, gh, repo: `foo/bar`, number: 42 })
    expect(
      board.signals.insert.mock.calls.some(
        (c: any[]) => (c[0] as { type: string }).type === `head_sha_changed`
      )
    ).toBe(true)
  })
})
