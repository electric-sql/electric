import { describe, expect, it } from 'vitest'
// Importing the barrel triggers each adapter's self-register at module load.
import { listAdapters } from '../../src'

// Tier 2 Phase C: locks every adapter's buildCliInvocation argv shape
// against a checked-in snapshot. Would have caught the opencode
// `--print-logs` accident at compile-time of the test suite, not at
// L2.1 runtime.
//
// To intentionally update: run `pnpm test -u` and review the diff.

describe(`adapter argv stability — ${listAdapters()
  .map((a) => a.kind)
  .join(`, `)}`, () => {
  const inputs: Array<{
    label: string
    args: { prompt: string; model?: string; nativeSessionId?: string }
  }> = [
    { label: `prompt-only`, args: { prompt: `P` } },
    { label: `with-model`, args: { prompt: `P`, model: `gpt-5-codex-latest` } },
    {
      label: `with-session`,
      args: {
        prompt: `P`,
        nativeSessionId: `01900000-0000-7000-8000-000000000000`,
      },
    },
    {
      label: `with-model-and-session`,
      args: {
        prompt: `P`,
        model: `gpt-5-codex-latest`,
        nativeSessionId: `01900000-0000-7000-8000-000000000000`,
      },
    },
  ]

  for (const adapter of listAdapters()) {
    for (const inp of inputs) {
      it(`${adapter.kind} — ${inp.label}`, () => {
        // opencode requires a model — skip the prompt-only / session-only
        // shapes for opencode rather than ratchet a non-shape error.
        if (adapter.kind === `opencode` && !inp.args.model) {
          return
        }
        const inv = adapter.buildCliInvocation(inp.args)
        expect({
          kind: adapter.kind,
          input: inp.args,
          args: inv.args,
          delivery: inv.promptDelivery,
        }).toMatchSnapshot()
      })
    }
  }
})

describe(`codex sandbox-bypass per target`, () => {
  // Codex's inner bwrap sandbox is redundant when the agent already runs
  // inside a Docker sandbox/sprite. Without bypass, every shell tool call
  // fails with "bwrap: No permissions to create a new namespace" on
  // macOS Docker Desktop. For target=host we leave codex's normal
  // sandbox engaged.
  const codex = listAdapters().find((a) => a.kind === `codex`)!

  it(`adds --dangerously-bypass-approvals-and-sandbox for target=sandbox`, () => {
    const inv = codex.buildCliInvocation({ prompt: `P`, target: `sandbox` })
    expect(inv.args).toContain(`--dangerously-bypass-approvals-and-sandbox`)
  })

  it(`adds --dangerously-bypass-approvals-and-sandbox for target=sprites`, () => {
    const inv = codex.buildCliInvocation({ prompt: `P`, target: `sprites` })
    expect(inv.args).toContain(`--dangerously-bypass-approvals-and-sandbox`)
  })

  it(`omits the bypass flag for target=host`, () => {
    const inv = codex.buildCliInvocation({ prompt: `P`, target: `host` })
    expect(inv.args).not.toContain(`--dangerously-bypass-approvals-and-sandbox`)
  })

  it(`omits the bypass flag when target is undefined`, () => {
    const inv = codex.buildCliInvocation({ prompt: `P` })
    expect(inv.args).not.toContain(`--dangerously-bypass-approvals-and-sandbox`)
  })
})
