# @electric-ax/agents

## 0.1.1

### Patch Changes

- 097f2c4: Add shared state support to worker agents and deep survey example
  - Worker agents can now observe a shared state DB via `sharedDb` spawn arg, generating per-collection CRUD tools
  - New `sharedDbToolMode` option controls whether `full` (read/write/update/delete) or `write-only` tools are generated
  - Rename `schema` parameter to `dbSchema` in `db()` observation source to avoid shadowing

- 46e0a75: Add skills system for dynamic knowledge loading with use_skill/remove_skill tools, including an interactive tutorial skill
- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
