# @electric-ax/agents-runtime

## 0.2.2

### Patch Changes

- e126eba: Harden pull-wake runner lifecycle with a state machine, heartbeat-driven stream resets, and exponential reconnect backoff (1s-30s). Add granular `status` field to `PullWakeRunnerHealth` (`stopped | starting | connecting | streaming | reconnecting | stopping`). The `onError` callback is now reporting-only (`(Error) => void`) - it can no longer control runner lifecycle. `stop()` rethrows `drainWakes` errors so callers observe wake handler failures. Event-driven heartbeat throttling avoids stale diagnostics between fixed-interval heartbeats. Durable Streams clients now append stream and `__ds` subscription control paths to the configured backend URL prefix without inferring a `/v1/stream` layout, so pull-wake subscriptions work behind arbitrary DS backend prefixes. Remove the stale `StreamClient.getConsumerState()` helper for the old Durable Streams `/consumers` endpoint.
- e126eba: Add pull-wake runner health check endpoint and rename `owner_user_id` to `owner_principal` across the runners system. The `GET /_electric/runners/:id/health` endpoint returns comprehensive diagnostics including runner state, client-reported stream/heartbeat/claim metrics, active claims, and dispatch stats with a derived health status (healthy/degraded/unhealthy). The `PullWakeRunner` now tracks internal diagnostics and reports them to the server via heartbeats, stored in a separate `runner_runtime_diagnostics` table so the main `runners` shape stays stable for normal UI sync. The `owner_user_id` → `owner_principal` rename stores canonical principal URLs instead of keys, with strict validation and canonicalization at route boundaries. The migration expires active runner claims and deletes existing runner rows as part of the principal rewrite. This is a breaking change with no backward compatibility — all callers must send principal URLs.

## 0.2.1

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
- Updated dependencies [dfc9a45]
  - @electric-ax/agents-mcp@0.2.2

## 0.2.0

### Minor Changes

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

### Patch Changes

- dec65ae: Resolve configured pull-wake runner headers before opening the durable wake stream.
- Updated dependencies [dec65ae]
  - @electric-ax/agents-mcp@0.2.1

## 0.1.3

### Patch Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.
- f509387: Stabilise chat section identity across streaming updates: `buildSections` / `buildTimelineEntries` in `use-chat` now key a fingerprint-based section cache by `run.key` / `msg.key`, so settled rows return the same reference even when the upstream pipeline rebuilds row objects. Adds a bounded prune pass + a `__resetSectionCachesForTesting` hook for test isolation. Also small cleanups in `tools/context-tools.ts`.
- 590aabb: Improve the agents UI timeline and reactivity, add a browser-safe runtime client export, and route built-in agent metadata extraction through the configurable low-cost model runner.
- 744c47f: Replace static entity write tokens with claim-scoped tokens. Write tokens are now issued when a consumer claims a wake and revoked on done, preventing leaked credentials from granting permanent write access. Removes `writeToken` from webhook notifications and spawn response headers.
- 28d127b: Electron desktop shell, tile-based workspace, and per-session
  working-directory picker.
  - `@electric-ax/agents-desktop`: new package — Electron app
    bundling a local Horton runtime, system-tray status, multi-
    window support, frameless windows with in-app title bars,
    native menus, About dialog, on-launch API key prompt
    (Anthropic / OpenAI / Brave), localhost agent-server discovery,
    and HMR via `vite-plugin-electron`.
  - `@electric-ax/agents-server`: entrypoint support for the local
    desktop runtime wiring.
  - `@electric-ax/agents-server-ui`: tile-based workspace (DnD,
    splits, persisted layouts, shareable URLs), redesigned new-
    session screen, refreshed dropdown chrome (`Combobox`
    primitive, sentence-case section headings, ServerPicker-style
    rows), sidebar filter & view menu with grouping by date /
    type / status / working dir, full Settings screen with
    General / Appearance / Local Runtime categories.
  - `@electric-ax/agents`: Horton accepts an optional
    `workingDirectory` spawn arg so each session can run against
    its own project root without restarting the runtime.
  - `@electric-ax/agents-runtime`: tool-pair preservation during
    compaction and matching tool-call events by id (bug fixes
    surfaced while building the desktop UI).
  - `@electric-sql/experimental`, `@electric-sql/react`: align test
    type configuration with DOM AbortSignal types used by the client.

- 6399147: Preserve the caller's HOME environment variable when running bash tool commands so CLIs can find user-level config and credentials.
- a3cee92: Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
- 7f8947a: Require low-cost model calls to provide an explicit system prompt and add prompts for URL extraction and skill metadata extraction.
- Updated dependencies [1df7cce]
  - @electric-ax/agents-mcp@0.2.0

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
