---
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-desktop': patch
---

Show elapsed time while an agent is responding. While a turn is
streaming, the meta row now ticks `Thinking · 12s` (or just `12s` once
tokens start flowing). When a turn settles, the bare `✓ done` becomes
`✓ done in 1m 5s` for turns completed in-session. Historical turns
(already complete on page load) keep the bare label, since the client
has no reliable completion timestamp for those — only the user message
time, and subtracting `now()` would lie about the duration.
