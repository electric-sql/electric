# @electric-ax/agents-server

## 0.5.0

### Patch Changes

- 8bc630a: Add generic externally-writable custom collections for agent entity state: collections opt in via `externallyWritable`, writes go through an authenticated schema-validated endpoint that stamps the principal into a read-only `_principal` column, and `createEntityTimelineQuery` can project them into the timeline via `customSources`. Comments are reimplemented as one such collection, gated per agent type through a reserved `comments/v1` contract that the UI keys its comment affordances on. External writes are restricted to a per-collection operations allowlist (insert-only by default), and comments are insert-only.
- Updated dependencies [708c946]
- Updated dependencies [8bc630a]
- Updated dependencies [c48c1a8]
- Updated dependencies [c1f3aac]
  - @electric-ax/agents-runtime@0.4.0

## 0.4.20

### Patch Changes

- 671a38f: Sanitize attachment Content-Disposition filename fallbacks to avoid ByteString errors for Unicode filenames.
- 50e93c2: Add editable session titles: a `set_title` tool for Horton, click-to-edit UI in EntityHeader, and txid propagation for tag/send/inbox mutations so clients can await sync consistency.
- 618810c: Stop orphaned cron wakes after schedule deletion by clearing stale wake-registry entries and ending cron tick chains with no subscribers.
- 4640704: Add pg-sync observation source enabling agents to observe Electric Postgres shape streams and wake on matching row changes (insert/update/delete). Includes server-side bridge management with cursor persistence, durable stream forwarding, and an `observe_pg_sync` tool for Horton agents.
- eed9ade: agents-server: harden the Electric shape proxy (`/_electric/electric/v1/shape`) against access-control bypasses. Requests for tables outside the explicitly scoped allowlist are now rejected with `403 TABLE_NOT_ALLOWED` instead of being forwarded with the privileged Electric secret and no row/column filter. Client-supplied `where` clauses that are not self-contained (unbalanced parentheses, top-level paren underflow, unterminated string/identifier literals, or SQL comment markers) are rejected with `400 INVALID_WHERE` so they cannot break out of the enforced per-tenant/per-principal scoping.
- Updated dependencies [baee54e]
- Updated dependencies [b8875a2]
- Updated dependencies [50e93c2]
- Updated dependencies [73c6f89]
- Updated dependencies [4640704]
- Updated dependencies [87be539]
- Updated dependencies [004bea1]
  - @electric-ax/agents-runtime@0.3.13
  - @electric-sql/client@1.5.21

## 0.4.19

### Patch Changes

- a044ede: agents-server, agents-runtime: fix two first-spawn races that prevented writer-side shared-state entities from reaching their first handler run on a fresh tenant.

  **agents-server**: `PUT /_electric/shared-state/<id>` now inserts the corresponding `shared_state_links` row synchronously whenever the request carries a valid `electric-owner-entity` header and the principal can access the entity. Previously this PUT only ran the authz check; the link row was created later — asynchronously — when the entity's manifest stream event was processed via `applyManifestEntitySource`. The runtime's `mkdb` wiring schedules the PUT and the preload GET back-to-back, so the GET always raced ahead of the eventually-consistent link insert and returned `401 UNAUTHORIZED: Principal is not allowed to read shared state` on every fresh-tenant first wake.

  **agents-runtime**: `createChildDb` (used by entity observations) now swallows `Stream not found` / `404` on initial preload. A handler may legitimately observe an entity that hasn't been spawned yet — e.g. a parent observes its own future child to wake on the child's `runFinished`. Treating the 404 as "no events yet" matches the spirit of the observation (we'll be woken when the entity appears); the previous unconditional throw aborted the entire wake with `HTTP Error 404 ... Stream not found`, and the entity could never recover because the spawn that would create the child never ran.

  Verified end-to-end with OpenFactory's `daily-digest` entity (uses `mkdb` + `observe(db(...))` + `observe(entity(<future child>))`) against a freshly torn-down local agents-server: the first `run-now` now writes the digest row, the discord-router subscriber picks it up, and the digest reaches Discord — without manual SQL or out-of-band link bootstrapping.

- Updated dependencies [5238055]
- Updated dependencies [916f6cd]
- Updated dependencies [a044ede]
  - @electric-ax/agents-runtime@0.3.12

## 0.4.18

### Patch Changes

- d15852d: Fix runtime-originated agent send attribution by sending `from_principal`, `from_agent`, and the active wake write token, and accepting `from_agent` when backed by a valid agent write token.
- 5aa2d78: Add server-resolved fork anchor + spawn-parity body fields to `POST /_electric/entities/<type>/<id>/fork`.
  - `anchor: 'latest_completed_run'` is an alternative to `fork_pointer`: the server scans the source root's `main` history, finds the most recent `runs` row with `status === 'completed'`, derives the matching `{ offset, sub_offset }` pointer, and runs the existing pointer-fork path with it. Mutually exclusive with `fork_pointer` (400 if both); 400 if no completed run exists. Lets callers without access to the source's per-row pointer side-table (e.g. an agent forking via a tool) fork at the same anchor the per-row "Fork from here" UI uses.
  - `parent` overrides the new root fork's `parent` field, making it a CHILD of that URL (rather than inheriting the source's parent).
  - `wake` registers a subscription on the new root fork at fork time (same shape as `spawn`'s `wake`).
  - `initialMessage` is delivered to the new root fork via `entityManager.send` after `linkEntityDispatchSubscription` runs — same ordering spawn uses, so the dispatcher is subscribed before the inbox row lands and the fork actually wakes on the message instead of sitting idle.
  - `tags` are stamped on the new root fork in addition to those copied from the source.

  Together these let an agent fork itself as a child and receive replies via the same manifest-anchored wake mechanism `spawn` uses, with a single round-trip fork-and-dispatch.

  Chat UI: `readInboxText` falls back to `message` and `content` keys when `text` isn't present, so messages sent by agents (which sometimes emit those shapes) render as a chat bubble body instead of a blank bar.

- Updated dependencies [d15852d]
- Updated dependencies [5aa2d78]
- Updated dependencies [1099366]
- Updated dependencies [1099366]
  - @electric-ax/agents-runtime@0.3.11

## 0.4.17

### Patch Changes

- 3ecdade: Add structured composer input support, slash command registration, and proactive skill context loading.
- Updated dependencies [3ecdade]
  - @electric-ax/agents-runtime@0.3.10

## 0.4.16

### Patch Changes

- 9fdf96a: Track agent-originated sends with `from_agent` / `from_principal` inbox metadata and render agent/self-send inbox messages with JSON payload fallbacks.
- 6434774: Add owner-default agents-server permissions with type-level spawn grants, entity grants, effective permission materialization, principal-scoped entity observation streams, shared-state access links, runtime registration permission grants, and default user spawn grants for built-in Horton and Worker types.

  Existing entity observation bridges are rebuilt after upgrade because pre-permission bridge rows do not include principal attribution.

  Entity `manage` grants participate in read visibility, entity-type `manage` grants participate in spawn visibility, and broad parented spawn-time grants require `manage` on the parent.

- b2bf806: Upgrade `@durable-streams/state` to `0.3.1` and drop the `@tanstack/db` pnpm override.

  `@durable-streams/state@0.3.x` makes `@tanstack/db` an optional peer dependency (it was a direct `^0.6.0` dependency) and splits its tsdb-coupled tools into a `@durable-streams/state/db` subpath. tsdb-specific imports (`createStreamDB`, `queryOnce`, `createTransaction`, query operators, etc.) now come from `@durable-streams/state/db`; the bare entry keeps only the tsdb-free types and helpers.

  Because state no longer pulls its own `@tanstack/db` copy, the root `pnpm.overrides` collapsing `@tanstack/db@>=0.6.0 <0.7.0` to `0.6.7` is removed. To keep a single `0.6.7` instance without it, `@tanstack/react-db` is raised to `^0.1.85` and `@tanstack/electric-db-collection` to `^0.3.5` (both pin `@tanstack/db@0.6.7`), and `@durable-streams/server` to `^0.3.7` (depends on `state@0.3.1`, removing the lingering transitive `state@0.2.9`).

- 5f96a15: Grant all users manage permission on the built-in Horton entity type by default, and backfill existing agents-server installations that already registered Horton without that grant.
- 12f1d17: Mirror user principals into the tenant-scoped `users` table when principal entities are materialized, while preserving any profile fields enriched by host-specific identity sync.
- d14d9a9: Remove the unused per-entity agents error stream. Entities now expose only their main stream; spawn, fork, registry lookup, terminal signal handling, UI/runtime types, client helpers, and conformance tests no longer create or require an entity-level error stream.
- 7c62024: Remove the old child-handle result API (`EntityHandle.run` and `EntityHandle.text()`) and internal spawn run promise plumbing. Child coordination should use durable `runFinished` server wakes with `includeResponse` so parent handlers can return safely instead of waiting in-memory for child output.
- 889fa20: Expose tenant-scoped users as an Electric shape and add a chat sharing dialog that grants user principals or all workspace users view, chat, or manage permissions over an entity. View/chat sharing includes fork access, forked chats are owned by the principal that creates the fork, shared chats can be identified and filtered by creator in the sidebar, and Cloud requests now inject the signed-in user as the Electric principal.

  Mobile now syncs the users and effective-permissions shapes, marks and filters shared chats by creator, disables native chat and signal controls when the current principal lacks permission, and shows the signed-in user principal on the Account screen for debugging.

- 048e2b6: Grant all users manage permission on the built-in Worker entity type by default, and backfill existing agents-server installations that already registered Worker without that grant.
- Updated dependencies [9fdf96a]
- Updated dependencies [312f5ec]
- Updated dependencies [6434774]
- Updated dependencies [4f88e6d]
- Updated dependencies [b2bf806]
- Updated dependencies [74d2341]
- Updated dependencies [d14d9a9]
- Updated dependencies [7c62024]
  - @electric-ax/agents-runtime@0.3.9

## 0.4.15

### Patch Changes

- 17b374f: Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep), and `dockerSandbox()` (container isolation via `dockerode` as an optional peer dep).

  Built-in entities (Horton, Worker) default to `unrestrictedSandbox` via the new `chooseDefaultSandbox(workingDirectory)` helper. Stronger isolation is opt-in by constructing `dockerSandbox` or `remoteSandbox` directly — `dockerSandbox` is the recommended path for multi-entity hosting.

  Behavior changes folded in: bash no longer forwards `process.env` to children (removes the trivial `env`-dump leak of secrets like `$ANTHROPIC_API_KEY` — note the host-sharing `unrestricted` provider still can't fully contain secrets, e.g. via `/proc/<ppid>/environ`, so use `docker`/`remote` for untrusted or multi-tenant entities), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

  Runtimes advertise named **sandbox profiles** (e.g. `local`, `docker`) to the agents-server; spawn requests pick a profile by name, the server validates the choice against the target runner's advertised set, and the new-session UI surfaces a picker. Internally, the built-in tool factories (`createBashTool`, `createFetchUrlTool`, etc.) now route their filesystem and network access through the active `Sandbox`.

- d5708c7: Fork at an earlier message instead of only at HEAD. `POST /_electric/entities/<type>/<id>/fork` accepts an optional `fork_pointer: { offset, sub_offset }` (snake_case wire) that truncates the new entity's `main` stream up to and including the chosen event; shared-state streams still clone at HEAD; the root's manifest is filtered so descendants spawned after the pointer are dropped from the fork along with their subtrees. Pointer-forks skip the all-subtree-idle wait on the root (the historical read can't be torn by concurrent writes past the pointer), so the affordance works during the post-run keep-alive window. UI: hover-revealed "Fork from here" button on user-message bubbles in `ChatView`, anchored to the latest preceding completed `runs` row; suppressed on the first message and while a run is in flight.
- f2d3d5e: Render self-send wake notifications with the sent message payload in the agent timeline.
- Updated dependencies [17b374f]
- Updated dependencies [1a7d72e]
- Updated dependencies [d5708c7]
- Updated dependencies [f2d3d5e]
  - @electric-ax/agents-runtime@0.3.8

## 0.4.14

### Patch Changes

- 9a92af5: Defer logger initialization to first use so packaged Electron apps (where cwd is `/`) no longer crash trying to `mkdir '/logs'`. Logger init is now wrapped in try-catch with stderr fallback so logging infrastructure never throws. Add `ELECTRIC_AGENTS_LOG_FILE=false` escape hatch to the agents package for parity with agents-server.
- Updated dependencies [ae2d039]
- Updated dependencies [9e01e58]
  - @electric-sql/client@1.5.20
  - @electric-ax/agents-runtime@0.3.7

## 0.4.13

### Patch Changes

- 98b51d6: Update Electric Agents packages to depend on the stable Durable Streams
  packages instead of pkg.pr builds. This pulls in `@durable-streams/client`
  0.2.6, `@durable-streams/server` 0.3.5, and `@durable-streams/state` 0.2.9.
  Examples now resolve `@electric-ax/agents-runtime` from the workspace so they
  do not keep older registry runtime builds pinned in the lockfile.
- 52a641f: Add manifest-backed attachments for agents.

  Attachments are uploaded through entity routes, stored in private attachment streams, referenced by manifest entries, and exposed to runtime handlers through `ctx.attachments`. The server UI can attach image files to user messages, renders message attachments with authenticated preview/download actions, exposes image previews from attachment manifest rows, rolls back uploaded attachments when send fails, and hides image attachment controls for models whose registered pi-ai metadata does not include image input. Image hydration now has a simple newest-images byte/count guardrail. Horton title generation now also works when the first user message is sent after attachment upload, including image-only starts.

- Updated dependencies [e9ea591]
- Updated dependencies [98b51d6]
- Updated dependencies [aed2189]
- Updated dependencies [52a641f]
  - @electric-ax/agents-runtime@0.3.6

## 0.4.12

## 0.4.11

### Patch Changes

- 265740e: Guard wake registry sync bootstrap against malformed shape messages without headers.
- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- Updated dependencies [d344c32]
- Updated dependencies [c1834f3]
- Updated dependencies [319e405]
  - @electric-ax/agents-runtime@0.3.5

## 0.4.10

## 0.4.9

### Patch Changes

- 833a1cb: Add agent event source contracts and dynamic event source subscription tools. Agents can list active, agent-visible webhook-backed event sources, subscribe entities to resolved bucket streams with explicit lifetimes, and persist those subscriptions as manifest-backed wake registrations. Bucket params are validated against the advertised `paramsSchema` before a subscription is accepted. Horton now receives these tools through the built-in agents runtime by default. Runtime-managed event source wakes now hydrate matching webhook rows into the agent trigger message so tool-created subscriptions include the event payload that caused the wake.
- Updated dependencies [833a1cb]
- Updated dependencies [1349a55]
- Updated dependencies [833a1cb]
  - @electric-ax/agents-runtime@0.3.4
  - @electric-sql/client@1.5.19

## 0.4.8

### Patch Changes

- dffbf62: fix: no more duplicated runFinished wakes
- Updated dependencies [9c2c3ae]
- Updated dependencies [a70567e]
- Updated dependencies [b3d4f02]
- Updated dependencies [dffbf62]
  - @electric-ax/agents-runtime@0.3.3

## 0.4.7

### Patch Changes

- e13cad1: Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
- Updated dependencies [e13cad1]
- Updated dependencies [4d9c36e]
  - @electric-ax/agents-runtime@0.3.2

## 0.4.6

### Patch Changes

- 9f10b20: Update Durable Streams server webhook support to Ed25519/JWKS signatures. Agents-server now exposes its own stream-root JWKS endpoint, supports injectable webhook signing keys/signers, validates upstream Durable Streams webhook signatures, rewrites subscription signing metadata to the agents-server JWKS, re-signs forwarded webhook deliveries, and preserves bodyless upstream 204/205/304 subscription responses. Agents-runtime now validates webhook signatures before dispatching wakes.
- c02dd6d: Fix `materializeHeartbeatClaim` nulling out `consumer_claims.lease_expires_at` when called without a lease argument. The heartbeat path is now an alive-ping only — it updates `last_heartbeat_at` and leaves the lease (set at claim materialization time from the upstream `lease_ttl_ms`) intact. Callers that genuinely want to extend the lease can still pass `leaseExpiresAt` explicitly.
- c6fb22d: Fix pull-wake claims leaking in `consumer_claims` after dispatch. The release path in `callback-forward` was gated entirely on the in-memory write-token state, so any condition that lost or evicted the token (server restart, a newer wake on the same stream) would prevent `materializeReleasedClaim` from running and leave the DB row pinned at `status='active'`. The fix decouples the durable-row release (keyed by `consumerId + epoch`) from in-memory token cleanup, and uses `entityCleared || stillOwnsClaim` to gate the entity status transition back to `idle`. Includes regression tests in `test/webhook-forward-routing.test.ts`.
- Updated dependencies [ca01b9d]
- Updated dependencies [9f10b20]
  - @electric-ax/agents-runtime@0.3.1

## 0.4.5

### Patch Changes

- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.
- Updated dependencies [9c275b7]
- Updated dependencies [1ab43f5]
- Updated dependencies [99ac6fd]
- Updated dependencies [adc99e9]
  - @electric-ax/agents-runtime@0.3.0

## 0.4.4

### Patch Changes

- e126eba: Harden pull-wake runner lifecycle with a state machine, heartbeat-driven stream resets, and exponential reconnect backoff (1s-30s). Add granular `status` field to `PullWakeRunnerHealth` (`stopped | starting | connecting | streaming | reconnecting | stopping`). The `onError` callback is now reporting-only (`(Error) => void`) - it can no longer control runner lifecycle. `stop()` rethrows `drainWakes` errors so callers observe wake handler failures. Event-driven heartbeat throttling avoids stale diagnostics between fixed-interval heartbeats. Durable Streams clients now append stream and `__ds` subscription control paths to the configured backend URL prefix without inferring a `/v1/stream` layout, so pull-wake subscriptions work behind arbitrary DS backend prefixes. Remove the stale `StreamClient.getConsumerState()` helper for the old Durable Streams `/consumers` endpoint.
- e126eba: Add pull-wake runner health check endpoint and rename `owner_user_id` to `owner_principal` across the runners system. The `GET /_electric/runners/:id/health` endpoint returns comprehensive diagnostics including runner state, client-reported stream/heartbeat/claim metrics, active claims, and dispatch stats with a derived health status (healthy/degraded/unhealthy). The `PullWakeRunner` now tracks internal diagnostics and reports them to the server via heartbeats, stored in a separate `runner_runtime_diagnostics` table so the main `runners` shape stays stable for normal UI sync. The `owner_user_id` → `owner_principal` rename stores canonical principal URLs instead of keys, with strict validation and canonicalization at route boundaries. The migration expires active runner claims and deletes existing runner rows as part of the principal rewrite. This is a breaking change with no backward compatibility — all callers must send principal URLs.
- Updated dependencies [e126eba]
- Updated dependencies [e126eba]
  - @electric-ax/agents-runtime@0.2.2

## 0.4.3

### Patch Changes

- c4e046f: Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.

  Add first-launch onboarding for Electric Cloud sign-in and LLM API keys, plus a Cloud Agent Servers settings section that syncs the user's Cloud agent servers, mints per-tenant agents tokens in the main process, and connects the desktop runtime/UI to tenant-scoped Cloud agents URLs without exposing those tokens to the renderer or `settings.json`.

- 47f17f1: Route Durable Streams subscription control traffic through the reserved `__ds` prefix under each stream URL. Agents-server now accepts control routes at the server-root `__ds` prefix, proxies them before normal stream operations, and forwards Durable Streams requests through the resolved tenant stream root instead of inferring cloud-specific URL shapes.
- Updated dependencies [a15c7b6]
  - @electric-sql/client@1.5.18

## 0.4.2

### Patch Changes

- 0ac67fd: Fix pull-wake dispatch for spawns with an initial message by appending the inbox message before linking the dispatch subscription.
- 28831c3: Enable Postgres type fetching so array parameters bind with the correct PostgreSQL array OIDs.

## 0.4.1

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
- Updated dependencies [dfc9a45]
- Updated dependencies [83204d9]
  - @electric-ax/agents-runtime@0.2.1

## 0.4.0

### Minor Changes

- dec65ae: Add tenant-scoped Durable Streams bearer auth for agents-server library hosts.

  Tenant runtimes and request contexts can now provide a static bearer token or a
  zero-argument token provider for downstream Durable Streams requests.

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

### Patch Changes

- d8cb2bb: Fix Docker build by adding missing `agents-mcp` package to the Dockerfile.
- 443482a: Prepare the agents server and server conformance test packages for public npm publication.

  The agents server package now publishes its Drizzle migration files alongside the built entrypoints so installed servers can run database migrations outside the monorepo.

- dec65ae: Fix shared multi-tenant scheduler queries to bind tenant id filters as typed
  Postgres text arrays.
- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents-runtime@0.2.0

## 0.3.0

### Patch Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.
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

- a3cee92: Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [744c47f]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
- Updated dependencies [92a332e]
  - @electric-ax/agents-runtime@0.1.3
  - @electric-sql/client@1.5.17

## 0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2
  - @electric-sql/client@1.5.16

## 0.2.6

### Patch Changes

- 1218851: Pull in the latest `@electric-ax/agents-server-ui` bundle: replaces the old editorial/control/workshop font-theme picker with a single dark-mode toggle in the sidebar footer, and rewires `styles.css` to the Electric Agents brand palette (warm-stone light + deep-night dark, with navy/teal accents). Preference persists to `localStorage` and falls back to `prefers-color-scheme`.

## 0.2.5

### Patch Changes

- 1b334eb: Expose shared-state StreamDB sources in the embedded agents server UI state explorer.
- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.2.4

### Patch Changes

- 89debcf: Pull in the latest `@electric-ax/agents-server-ui` bundle (3-tab coder spawn dialog, queued-prompt timeline rows, full nativeSessionId in the session header) and minor comment cleanup in the proxied-CORS path.
- 491ba04: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from agents-server to agents package, removing duplicate code. Tools are now exported from `@electric-ax/agents`.
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.2.3

### Patch Changes

- e311cf1: feat: ui improvements

## 0.2.2

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.2.1

### Patch Changes

- 50bbf06: fix: ensure public url of the server is used everywhere
- 842182d: fix: ensure CORS is set to \*
- 4e60832: fix: improve docker image size
- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.2.0

### Minor Changes

- 0589cbc: Add state explorer panel to entity view with real-time StreamDB state visualization, time-travel through events, and jump-to-bottom button on timelines

### Patch Changes

- e52563c: feat: allow secret setting for electric instance

## 0.1.1

### Patch Changes

- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
