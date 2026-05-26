import { describe, expect, it } from 'vitest'
import { renderStatusComment } from '../../src/agents/pr-shared/status-comment'

const base = {
  pr_meta: { number: 42 } as any,
  gates: {
    template_ok: true,
    ci_green: true,
    no_conflicts: true,
    threads_resolved: true,
    docs_ok: true,
    ready_to_merge: true,
  } as any,
  agent_state: [
    {
      role: `reviewer`,
      iterations: 1,
      cap: 5,
      paused: false,
      pause_reason: null,
    },
    {
      role: `build-doctor`,
      iterations: 0,
      cap: 3,
      paused: false,
      pause_reason: null,
    },
    {
      role: `doc-editor`,
      iterations: 0,
      cap: 3,
      paused: false,
      pause_reason: null,
    },
  ] as any,
  commits: [
    {
      sha: `abcdef0`,
      author_agent: `pr-reviewer`,
      message: `[agent:reviewer] fix x`,
      ts: `2026-05-09T00:00:00Z`,
    },
  ] as any,
  pendingChecks: 0,
  failingChecks: 0,
  openMustFix: 0,
}

describe(`renderStatusComment`, () => {
  it(`shows all-green ready-to-merge`, () => {
    const out = renderStatusComment(base, new Date(`2026-05-09T00:00:01Z`))
    expect(out).toContain(`Agent status — PR #42`)
    expect(out).toContain(`| **Ready to merge** | ✅`)
    expect(out).toContain(`<!-- agent-managed-status -->`)
  })

  it(`shows pending and failing CI states`, () => {
    const out = renderStatusComment(
      {
        ...base,
        gates: { ...base.gates, ci_green: false },
        pendingChecks: 2,
        failingChecks: 1,
      } as any,
      new Date()
    )
    expect(out).toMatch(/CI.*🔴 1 failing/)
  })

  it(`lists paused agents with pause reason`, () => {
    const out = renderStatusComment(
      {
        ...base,
        agent_state: [
          ...base.agent_state.slice(0, 1),
          {
            role: `build-doctor`,
            iterations: 3,
            cap: 3,
            paused: true,
            pause_reason: `cap reached`,
          },
          ...base.agent_state.slice(2),
        ] as any,
      },
      new Date()
    )
    expect(out).toContain(`### Paused agents`)
    expect(out).toContain(`build-doctor`)
    expect(out).toContain(`cap reached`)
    expect(out).toContain(`/continue build-doctor`)
  })

  it(`omits paused section when no agent is paused`, () => {
    const out = renderStatusComment(base, new Date())
    expect(out).toContain(`_None_`)
  })

  it(`lists recent agent commits`, () => {
    const out = renderStatusComment(base, new Date(`2026-05-09T01:00:00Z`))
    expect(out).toContain(`abcdef0`)
    expect(out).toContain(`[agent:reviewer] fix x`)
  })
})
