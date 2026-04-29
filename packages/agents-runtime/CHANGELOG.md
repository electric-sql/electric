# @electric-ax/agents-runtime

## 0.1.2

### Patch Changes

- 1cb5020: feat: add better typing to all agent callbacks (missed changeset in 6bb1c7a0dc72d1ca76ee439f0cbd4e1470e84e0c)
- 1cb5020: fix: ensure fork doesn't reply last turn of the agent (missed changeset in 19f52f410f8a4fd7d3094b91d0aa2f3b39802a72)

## 0.1.1

### Patch Changes

- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).

## 0.1.0

### Minor Changes

- 4987694: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from `@electric-ax/agents` to `@electric-ax/agents-runtime` so they are available without importing the built-in agents package. **Breaking:** tool exports removed from `@electric-ax/agents` — import from `@electric-ax/agents-runtime` instead.

### Patch Changes

- 89debcf: Expose `ctx.recordRun()` returning a `RunHandle` so non-LLM entities can bracket external operations (CLI subprocess, HTTP call, etc.) with the same `runs` collection events that `useAgent` writes internally — satisfying the `runFinished` wake matcher and surfacing a response payload via `RunHandle.attachResponse(text)`.

## 0.0.4

### Patch Changes

- 9024ec2: fix: allow for `onPayload` to support non-standard model APIs

## 0.0.3

### Patch Changes

- 5ef535b: feat: allow arbitrary models instead of hardcoding anthropic
- 6d8be8b: fix: ensure api keys are correctly passed through

## 0.0.2

### Patch Changes

- 097f2c4: Add shared state support to worker agents and deep survey example
  - Worker agents can now observe a shared state DB via `sharedDb` spawn arg, generating per-collection CRUD tools
  - New `sharedDbToolMode` option controls whether `full` (read/write/update/delete) or `write-only` tools are generated
  - Rename `schema` parameter to `dbSchema` in `db()` observation source to avoid shadowing
