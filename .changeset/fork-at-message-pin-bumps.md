---
'@electric-ax/agents': patch
'@electric-ax/agents-server-conformance-tests': patch
'electric-ax': patch
---

Bump `@durable-streams/{client,server,state}` pins in step with `@electric-ax/agents-runtime` and `@electric-ax/agents-server` to pick up the fork-at-pointer (`Stream-Fork-Offset` + `Stream-Fork-Sub-Offset`) wire protocol that the new fork-at-message UX depends on. No other code changes in these packages.
