---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server-ui': patch
---

Context-usage indicator: a circular ring gauge plus a hover breakdown popover
showing how the prompt decomposes across system prompt, tools, messages, and
free space (à la Claude Code's `/context`). The runtime now persists an
approximate `context_breakdown` of the stable request parts (system + tools) on
each step alongside the cache-inclusive total, and exports new
`computeContextBreakdown` / `parseContextBreakdown` helpers from the client
entry; the UI derives the "messages" bucket as the real remainder so the
segments always sum to the gauge.
