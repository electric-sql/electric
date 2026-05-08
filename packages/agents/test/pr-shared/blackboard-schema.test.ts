import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import {
  PrBlackboardSchema,
  PrMetaRow,
  CheckRow,
  ReviewThreadRow,
  DocPlanRow,
  CommitRow,
  GatesRow,
  AgentStateRow,
  SignalRow,
} from '../../src/agents/pr-shared/blackboard-schema'

describe(`PrBlackboardSchema`, () => {
  const expected = [
    `pr_meta`,
    `checks`,
    `review_threads`,
    `doc_plan`,
    `commits`,
    `gates`,
    `agent_state`,
    `signals`,
  ]
  it.each(expected)(`declares collection %s with primaryKey "key"`, (name) => {
    const c = (PrBlackboardSchema as Record<string, { primaryKey: string }>)[
      name
    ]
    expect(c).toBeDefined()
    expect(c.primaryKey).toBe(`key`)
  })

  it(`accepts a singleton pr_meta row`, () => {
    const row = {
      key: `meta`,
      number: 42,
      repo: `a/b`,
      title: `t`,
      base_branch: `main`,
      base_sha: `aaa`,
      head_branch: `feat`,
      head_sha: `bbb`,
      description: ``,
      state: `open` as const,
      labels: [`agents`],
      mergeable: null,
      status_comment_id: null,
      agents_disabled: false,
      last_synced_at: `2026-05-09T00:00:00Z`,
    }
    expect(Value.Check(PrMetaRow, row)).toBe(true)
  })

  it(`accepts a signal row with consumed_by array`, () => {
    const row = {
      key: `01H...`,
      type: `pr_synced`,
      payload: {},
      ts: `2026-05-09T00:00:00Z`,
      consumed_by: [],
    }
    expect(Value.Check(SignalRow, row)).toBe(true)
  })

  it(`rejects a check row with unknown conclusion`, () => {
    const row = {
      key: `k`,
      name: `lint`,
      status: `completed`,
      conclusion: `maybe`,
      log_url: null,
      head_sha: `bbb`,
    }
    expect(Value.Check(CheckRow, row)).toBe(false)
  })

  it(`accepts review thread severities must-fix | suggestion | nit`, () => {
    for (const sev of [`must-fix`, `suggestion`, `nit`]) {
      expect(
        Value.Check(ReviewThreadRow, {
          key: `k`,
          file: `f`,
          line: 1,
          severity: sev,
          category: `c`,
          body: `b`,
          suggested_patch: null,
          status: `open`,
          addressed_by_sha: null,
          source: `agent`,
        })
      ).toBe(true)
    }
  })

  it(`exports gates and agent_state as singleton-friendly schemas`, () => {
    const g = {
      key: `gates`,
      template_ok: false,
      ci_green: false,
      no_conflicts: false,
      threads_resolved: false,
      docs_ok: false,
      ready_to_merge: false,
      last_evaluated_at: `2026-05-09`,
    }
    expect(Value.Check(GatesRow, g)).toBe(true)
    const a = {
      key: `reviewer`,
      role: `reviewer`,
      iterations: 0,
      cap: 5,
      paused: false,
      pause_reason: null,
      last_continue_grant_at: null,
      last_reviewed_sha: null,
      last_substantive_signature: null,
      iterations_skipped_since_review: 0,
      worktree_lock_holder: null,
    }
    expect(Value.Check(AgentStateRow, a)).toBe(true)
  })

  it(`accepts doc_plan and commits row shapes`, () => {
    expect(
      Value.Check(DocPlanRow, {
        key: `docs/api.md`,
        doc_path: `docs/api.md`,
        change: `update`,
        status: `done`,
        notes: ``,
      })
    ).toBe(true)
    expect(
      Value.Check(CommitRow, {
        key: `sha`,
        sha: `sha`,
        author_agent: `pr-reviewer`,
        message: `m`,
        parent_sha: `p`,
        ts: `t`,
      })
    ).toBe(true)
  })
})
