---
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-desktop': patch
---

Show per-response token usage in the agent meta row, e.g. `1.2k ↑ 412
↓`. Updates as each step settles — for a single-turn call this lands
once at done; for tool-using runs the counter jumps at each step
boundary (the LLM SDK only emits `usage` at end-of-step, so we can't
tick smoothly between tokens).

Plumbing:

- `StepValue` gains optional `input_tokens` / `output_tokens` columns
  (Zod + TS). Strictly additive: events recorded before this change
  stay valid since both fields are optional, so no migration.
- `outbound-bridge.ts:onStepEnd` now persists the `tokenInput` /
  `tokenOutput` it already received from `pi-adapter.ts` — previously
  those values were accepted and silently dropped.
- `EntityTimelineStepItem` / `IncludesStep` surface the new fields,
  and the three `.select()` blocks that materialize steps include
  them.
- The cached `agent_response` section gets a `tokens?: { input?,
  output? }` summed across the run's steps at section-build time, and
  the section-cache fingerprint factors in step token deltas so a
  late-arriving `onStepEnd` invalidates a stale section.
