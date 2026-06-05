---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server-conformance-tests': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-server': patch
'electric-ax': patch
---

Remove the unused per-entity agents error stream. Entities now expose only their main stream; spawn, fork, registry lookup, terminal signal handling, UI/runtime types, client helpers, and conformance tests no longer create or require an entity-level error stream.
