# @electric-ax/agents-runtime

## 0.3.7

### Patch Changes

- 9e01e58: Preserve and surface detailed run failure information from the Pi adapter so failed runs can render actionable error details instead of a generic failure message.

## 0.3.6

### Patch Changes

- e9ea591: Show detailed agent run failure information in the timeline instead of the generic `Run failed` fallback. Run errors now include their error code, failed tool calls preserve and render their error text, and failed runs fall back to tool errors or finish reasons when no run error row is available.
- 98b51d6: Update Electric Agents packages to depend on the stable Durable Streams
  packages instead of pkg.pr builds. This pulls in `@durable-streams/client`
  0.2.6, `@durable-streams/server` 0.3.5, and `@durable-streams/state` 0.2.9.
  Examples now resolve `@electric-ax/agents-runtime` from the workspace so they
  do not keep older registry runtime builds pinned in the lockfile.
- aed2189: Add Kimi / Moonshot API support for local Horton runtimes, including model catalog entries, runtime provider resolution, desktop credential persistence, and UI credential inputs.
- 52a641f: Add manifest-backed attachments for agents.

  Attachments are uploaded through entity routes, stored in private attachment streams, referenced by manifest entries, and exposed to runtime handlers through `ctx.attachments`. The server UI can attach image files to user messages, renders message attachments with authenticated preview/download actions, exposes image previews from attachment manifest rows, rolls back uploaded attachments when send fails, and hides image attachment controls for models whose registered pi-ai metadata does not include image input. Image hydration now has a simple newest-images byte/count guardrail. Horton title generation now also works when the first user message is sent after attachment upload, including image-only starts.

## 0.3.5

### Patch Changes

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- c1834f3: Prepare the mobile app for Expo EAS builds and CI. Adds dynamic Expo config, EAS build profiles, mobile CI/export scripts, and aligns shared React/TypeScript dependency resolution so the Expo DOM embed typechecks and passes `expo-doctor`.
- 319e405: Explicit ChatGPT / Codex opt-in with native PKCE OAuth sign-in (opened in the user's default browser to avoid Cloudflare bot detection), per-source consent for detected Codex CLI / OpenCode logins, an inline "Use this login?" prompt under the new-session composer, and a "Restart local runtime" banner gated on credential changes. The runtime no longer reads `~/.codex/auth.json` implicitly — it now requires `ELECTRIC_CODEX_ACCESS_TOKEN` and honours `ELECTRIC_CODEX_REQUIRE_OPT_IN=1`.

## 0.3.4

### Patch Changes

- 833a1cb: Add agent event source contracts and dynamic event source subscription tools. Agents can list active, agent-visible webhook-backed event sources, subscribe entities to resolved bucket streams with explicit lifetimes, and persist those subscriptions as manifest-backed wake registrations. Bucket params are validated against the advertised `paramsSchema` before a subscription is accepted. Horton now receives these tools through the built-in agents runtime by default. Runtime-managed event source wakes now hydrate matching webhook rows into the agent trigger message so tool-created subscriptions include the event payload that caused the wake.
- 833a1cb: Add `webhook(endpointKey, { bucket })` observation sources for webhook ingress streams, including deterministic stream path generation, event schema, default wake registration, and observe-time stream creation before preload.

## 0.3.3

### Patch Changes

- 9c2c3ae: Settle interrupted agent runs promptly when the model stream ignores abort completion, while preserving aborted run context ordering.
- a70567e: Add DeepSeek as a supported LLM provider.
  - `agents-runtime`: `detectAvailableProviders()` now detects `DEEPSEEK_API_KEY`; `deepseek` added to `AvailableProvider` type, `PREFERRED_IDS_BY_PROVIDER`, and `envCatalog()`
  - `agents`: model catalog probes `https://api.deepseek.com/v1/models` to surface available DeepSeek models (`deepseek-v4-flash`, `deepseek-v4-pro`); `deepseek-v4-flash` is the default fallback choice
  - `agents-desktop`: `ApiKeys` gains a `deepseek` field persisted in the keychain and mirrored to `DEEPSEEK_API_KEY` in the runtime environment
  - `agents-server-ui`: `ApiKeysForm` gains a DeepSeek API key input; `OnboardingModal` and `CredentialsPage` pass and persist the new field

- b3d4f02: feat: add self-send option to `send`
- dffbf62: fix: no more duplicated runFinished wakes

## 0.3.2

### Patch Changes

- e13cad1: Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
- 4d9c36e: Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.

## 0.3.1

### Patch Changes

- ca01b9d: Add the React Native agents mobile app package.
- 9f10b20: Update Durable Streams server webhook support to Ed25519/JWKS signatures. Agents-server now exposes its own stream-root JWKS endpoint, supports injectable webhook signing keys/signers, validates upstream Durable Streams webhook signatures, rewrites subscription signing metadata to the agents-server JWKS, re-signs forwarded webhook deliveries, and preserves bodyless upstream 204/205/304 subscription responses. Agents-runtime now validates webhook signatures before dispatching wakes.

## 0.3.0

### Minor Changes

- adc99e9: Move the `.md`-skill-directory loader (`createSkillsRegistry`) and the per-entity skill tool builder (`createSkillTools`) — together with the `SkillsRegistry` / `SkillMeta` types and the underlying `preamble` / `extract-meta` helpers — out of `@electric-ax/agents` and into `@electric-ax/agents-runtime`, alongside the rest of the entity-runtime primitives.

  No behaviour change. Same files, re-rooted to the package whose dependencies they already use: skills depend on `completeWithLowCostModel` and the runtime logger, both already in `agents-runtime`. The skills code uses zero symbols defined in `@electric-ax/agents`, so the previous arrangement had the dependency graph pointing the wrong way.

  This makes the skills primitives available to any package built on top of `agents-runtime` (e.g. external Discord / Slack / CLI bots) without pulling in Horton, Worker, or `BuiltinAgentsServer` as transitive context.

  Existing internal call sites in `@electric-ax/agents` (`bootstrap.ts`, `agents/horton.ts`) now import from `@electric-ax/agents-runtime`. No public API of `@electric-ax/agents` is affected — the skills surface was never re-exported from its `index.ts`, so embedders that only consumed Horton / Worker / Server APIs continue to work unchanged.

### Patch Changes

- 9c275b7: Add `send` tool exposing `ctx.send()` to LLM agents (Horton and Worker) for sending messages to Electric entities by URL. Change `send()` return type from `void` to `Promise<SendResult>` so callers can await delivery confirmation and handle failures with structured error results.
- 1ab43f5: The built-in `bash` tool's description no longer claims commands run in a sandboxed working directory. Behavior is unchanged; sandboxing is a deployment-time concern that lives outside the tool definition.
- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.

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
