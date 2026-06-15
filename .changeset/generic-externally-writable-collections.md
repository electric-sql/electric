---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents': patch
---

Add generic externally-writable custom collections for agent entity state: collections opt in via `externallyWritable`, writes go through an authenticated schema-validated endpoint that stamps the principal into a read-only `_principal` column, and `createEntityTimelineQuery` can project them into the timeline via `customSources`. Comments are reimplemented as one such collection, gated per agent type through a reserved `comments/v1` contract that the UI keys its comment affordances on. External writes are restricted to a per-collection operations allowlist (insert-only by default), and comments are insert-only.
