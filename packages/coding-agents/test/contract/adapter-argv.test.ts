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
