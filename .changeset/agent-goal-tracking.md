---
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
---

Add `/goal` slash command to Horton sessions. Lets the user set an
objective with an optional token budget; the agent works autonomously
toward the goal and stops when it calls `mark_goal_complete` or when
the run exceeds the budget.

```text
/goal set "ship feature X" --tokens 50k   # default 50k tokens
/goal set "explore" --unlimited           # opt out of the cap
/goal show                                 # current state
/goal complete                             # mark done manually
/goal clear                                # remove the goal
```

## Behaviour

- **One goal per session**, persisted as a `kind: 'goal'` entry on the
  `manifests` collection — resumes automatically across desktop
  restarts.
- **Mid-run token enforcement**: an `onStepEnd` hook on the outbound
  bridge surfaces per-step token counts; Horton accumulates them and
  aborts the active `ctx.agent.run()` via an `AbortController` once
  `tokensUsed >= tokenBudget`. The cap counts **new input (fresh +
  cache-write tokens) + output** per step — prompt-cache reads (which
  re-count the whole conversation on every warm step) are excluded, so
  the budget tracks new work rather than context size.
- **Live progress**: the goal banner ticks up after each step. The
  manifest update is written via `writeEvent` directly (not the
  wake-session's staged manifest transaction, which only commits at
  end-of-wake — too late for a long-running run).
- **`mark_goal_complete` tool**: registered on Horton's tool list.
  Flips status to `complete`, surfaces in the chat as an ordinary
  agent reply via the new `ctx.replyText` helper.
- **State-changing `/goal` commands interrupt the active run** —
  typing `/goal complete`, `/goal clear`, or `/goal set` while a run
  is in flight signals SIGINT alongside sending the message, so the
  prior run aborts instead of finishing the old work first. `/goal
  show` is read-only and does not interrupt.
- **Budget-limited stop message**: when the cap is hit mid-run, the
  agent posts a synthetic reply explaining what happened and
  suggesting a larger budget to resume.

## Plumbing

- `entity-schema.ts` — new `ManifestGoalEntryValue` (objective,
  status, tokenBudget, tokensUsed, createdAt, updatedAt) added to the
  manifest discriminated union.
- `goal-api.ts` (new) — `setGoal` / `clearGoal` / `getGoal` /
  `markGoalComplete` / `updateGoalUsage`. All goal mutations share a
  single ordered write channel (direct `writeEvent` upserts, live for
  the UI) plus an in-wake read-your-writes cache, so a mutation firing
  mid-run can never snapshot — and replay — a stale `tokensUsed` over
  a fresher one. `updateGoalUsage` additionally never decreases the
  counter.
- `goal-command.ts` (new) — `/goal` parser (`--tokens N|50k|1.2m|
  unlimited`, `--unlimited` flag, subcommand aliases `done`/`status`)
  and dispatcher.
- `tools/goal-tools.ts` (new) — `createMarkGoalCompleteTool` exposes
  the completion signal to the LLM.
- `outbound-bridge.ts` — new optional `OutboundBridgeHooks.onStepEnd`
  callback, threaded through `pi-adapter` and the `AgentConfig` passed
  to `useAgent`.
- `context-factory.ts` — `AgentHandle.run` now accepts an optional
  `abortSignal` and combines it with the runtime's `runSignal`. New
  `ctx.replyText(text)` writes a complete runs + texts + textDeltas
  sequence so synthetic replies render in the chat. New goal-related
  methods exposed on `HandlerContext`.
- `horton.ts` — `tryHandleSlashCommand` intercepts `/goal *` before
  the LLM; `/goal set` enqueues a one-shot kickoff so the agent starts
  immediately; `assistantHandler` wires the budget-enforcing
  `onStepEnd`, aborts on overflow, and posts the explanation reply.
- `agents-server-ui` — new `GoalBanner` component above the timeline
  (objective + budget bar + status badge). `MessageInput` aborts the
  active run when a state-changing `/goal` command is submitted.
  `EntityTimeline` / `EntityContextDrawer` handle the new `goal`
  manifest kind.
