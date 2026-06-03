---
'@electric-ax/agents': patch
---

Give Horton a `fork` tool so an agent can create a sibling session that inherits the current conversation's history up to its latest completed response. The tool takes an optional `entityUrl` (omit for self-fork) and delegates to `ctx.fork`, which auto-observes the new fork with `runFinished` + `includeResponse` so the caller wakes when the fork's next run finishes. Horton's system prompt grows a "When to fork (vs spawn_worker)" section framing the distinction — spawn for isolated subtasks with empty context, fork for parallel exploration that needs the conversation's full history — plus the end-turn-first / send-different-prompts / wait-for-all-responses workflow for parallel-exploration patterns (analyze, fork N times, synthesise the winner).
