---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
---

Add shared state support to worker agents and deep survey example

- Worker agents can now observe a shared state DB via `sharedDb` spawn arg, generating per-collection CRUD tools
- New `sharedDbToolMode` option controls whether `full` (read/write/update/delete) or `write-only` tools are generated
- Rename `schema` parameter to `dbSchema` in `db()` observation source to avoid shadowing
