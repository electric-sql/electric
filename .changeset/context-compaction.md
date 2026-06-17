---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server-ui': patch
---

Context compaction for the agents runtime. Modelled on OpenAI Codex's
summarization but adapted to the event-sourced timeline (a `context_inserted`
checkpoint placed at a stored watermark, so reconstruction folds older messages
into a summary):

- A context-window usage gauge (cache-inclusive `context_input_tokens` +
  `context_window` persisted per step) and `<token_budget>` notices injected at
  25 / 50 / 75% usage.
- Oversized tool-output truncation, and a synchronous mid-turn compaction floor
  at the 90% hard ceiling (runs before every model step via the adapter's
  `transformContext` hook).
- Non-blocking background (turn-end) compaction that starts at 85%: a detached
  summarize whose checkpoint is applied at the next turn's start, or immediately
  if it finishes while idle. Each generation uses a watermark-unique checkpoint
  id so a new run can't supersede a prior completed one. Summarize calls are
  bounded by a hard timeout.
- UI: a "Compacting…" indicator (blocking vs. background) and a collapsible
  "Context compacted" entry in the conversation timeline.

Thresholds are env-tunable (`ELECTRIC_AGENTS_COMPACT_CEILING`,
`ELECTRIC_AGENTS_COMPACT_BG_CEILING`).
