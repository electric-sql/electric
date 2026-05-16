import { describe, expect, it } from 'vitest'
import { buildWorkerPrelude } from '../../src/agents/pr-shared/prelude'

describe(`buildWorkerPrelude`, () => {
  const args = {
    role: `reviewer` as const,
    repo: `foo/bar`,
    number: 42,
    base_branch: `main`,
    head_sha: `abc123`,
    signal_type: `head_sha_changed`,
    signal_key: `sig-1`,
    signal_ts: `2026-05-09T00:00:00Z`,
    blackboard_id: `pr-foo/bar-42`,
    worktree_path: `/tmp/.worktrees/pr-42`,
  }
  const out = buildWorkerPrelude(args)

  it(`mentions the role, repo, PR number, base branch, head sha`, () => {
    for (const v of [`reviewer`, `foo/bar`, `42`, `main`, `abc123`])
      expect(out).toContain(v)
  })
  it(`names the blackboard id and signal context`, () => {
    expect(out).toContain(`pr-foo/bar-42`)
    expect(out).toContain(`head_sha_changed`)
    expect(out).toContain(`sig-1`)
  })
  it(`instructs the agent to load its skill via use_skill("pr-reviewer")`, () => {
    expect(out).toContain(`use_skill('pr-reviewer')`)
  })
  it(`includes working directory + persistent timeline note`, () => {
    expect(out).toContain(`/tmp/.worktrees/pr-42`)
    expect(out).toContain(`persistent timeline`)
  })
})
