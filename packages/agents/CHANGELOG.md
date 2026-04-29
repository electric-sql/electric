# @electric-ax/agents

## 0.2.2

### Patch Changes

- 4d8e452: Bundle Electric Agents documentation with the package so Horton can search docs without an external docs directory. Copies 39 markdown files from the docs site into `packages/agents/docs/` and updates `resolveDocsRoot` to find them relative to the module directory in both development and production builds.
- b0af010: Fix chat starter typing indicator: inline multiple agent names in a single line and use useChat state for reliable detection.
- b0af010: Redesign quickstart tutorial: replace chatroom steps with perspectives analyzer UI, add scaffold-based frontend with Radix Themes and Streamdown markdown, improve Horton prompt for docs search priority, add checkpoint with multiple paths after entity-building steps.

## 0.2.1

### Patch Changes

- 125c276: Improve Horton's onboarding: add warm greeting for initial messages and present multiple onboarding paths instead of defaulting to the quickstart skill.
- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.2.0

### Minor Changes

- 491ba04: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from agents-server to agents package, removing duplicate code. Tools are now exported from `@electric-ax/agents`.
- 4fc022b: Redesign Horton onboarding: rename tutorial to quickstart skill (extended with routes + frontend phases), add init skill for project scaffolding, add onboarding routing to system prompt, configurable docs URL via HORTON_DOCS_URL, upgrade to claude-sonnet-4-6, fix web search fallback tool definition, and remove duplicate braveSearchTool from agents-server (now exported from agents)
- 4987694: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from `@electric-ax/agents` to `@electric-ax/agents-runtime` so they are available without importing the built-in agents package. **Breaking:** tool exports removed from `@electric-ax/agents` — import from `@electric-ax/agents-runtime` instead.

### Patch Changes

- 89debcf: Add the `coder` entity (a Claude Code / Codex CLI session wrapped as a long-lived entity) and give Horton matching `spawn_coder` / `prompt_coder` tools so the chatbot can dispatch coding work and keep prompting the same coder across many turns. The coder records its own `runs` events around each CLI invocation and pipes the assistant reply through `attachResponse`, so observers waking with `runFinished` get the response in the wake payload. Includes `--skip-git-repo-check` for `codex exec`, deterministic per-cwd Claude session discovery (so non-interactive `claude -p` runs are found reliably), and adopts the first prompt's text as the entity's display title.
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.1.5

### Patch Changes

- 4801e76: fix: ensure builtin skills are packaged

## 0.1.4

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.1.3

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.1.2

### Patch Changes

- 1786ee6: feat: add shared state (sharedDb) support to built-in worker agent

## 0.1.1

### Patch Changes

- 097f2c4: Add shared state support to worker agents and deep survey example
  - Worker agents can now observe a shared state DB via `sharedDb` spawn arg, generating per-collection CRUD tools
  - New `sharedDbToolMode` option controls whether `full` (read/write/update/delete) or `write-only` tools are generated
  - Rename `schema` parameter to `dbSchema` in `db()` observation source to avoid shadowing

- 46e0a75: Add skills system for dynamic knowledge loading with use_skill/remove_skill tools, including an interactive tutorial skill
- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
