# @electric-ax/agents-desktop

## 0.1.18

### Patch Changes

- c48c1a8: Stream model reasoning / extended-thinking content into the UI. While
  the model is "thinking" (Anthropic extended thinking, DeepSeek-R1
  reasoning, Moonshot K2, OpenAI Responses summaries) the agent response
  now shows the live reasoning text faded above the answer, with the
  existing `Thinking` shimmer heading and an elapsed-time ticker. Once
  the reasoning settles it collapses to `▸ Thought for 12s` — click to
  expand. Multiple reasoning rows per run are rendered independently in
  order, so tool-using turns show each step's reasoning separately.

  Implementation:
  - **Schema** — `reasoning` row gains `run_id`, `encrypted` (Anthropic
    redacted-thinking opaque payload, must round-trip back to the model
    verbatim), and `summary_title` (extracted at write time for
    providers that emit a bolded heading). New `reasoningDeltas`
    collection mirrors `textDeltas` for streamed content.
  - **Bridge** — `OutboundBridge` gains `onReasoningStart` /
    `onReasoningDelta` / `onReasoningEnd`, parallel to the text path.
  - **Adapter** — `pi-adapter.ts` routes pi-ai's `thinking_start` /
    `thinking_delta` / `thinking_end` events to the bridge, parses the
    `**Title**\n\n<body>` heading (OpenAI Responses only) once at
    `thinking_end` so the UI doesn't re-parse on every render.
  - **Timeline** — `EntityTimelineRunRow` gains a live
    `reasoning: Collection<EntityTimelineReasoningItem>` with content
    built from a delta-join, mirroring `EntityTimelineTextItem`.
  - **UI** — New `<ReasoningSection>` component renders above the
    answer in `AgentResponseLive`. Live shows faded markdown via
    `Streamdown` with `ThinkingIndicator` heading + summary title +
    elapsed-time ticker. Settled collapses to `Thought for Ns` with
    click-to-expand. Redacted Anthropic blocks render a single muted
    line — content is opaque, but the encrypted payload is still
    persisted server-side so the model gets it back next turn.

  Providers without reasoning emit nothing → no reasoning section
  rendered. Historical responses recorded before this PR have no
  closure cue, same as today.

  Anthropic extended thinking is now always-on for reasoning-capable
  models: `reasoningEffort: auto` maps to the minimal budget
  (1024 tokens), matching the OpenAI branch where `auto` already
  defaulted to `minimal`. Explicit `low`/`medium`/`high` scale the
  budget as before.

## 0.1.17

### Patch Changes

- 4640704: Add pg-sync observation source enabling agents to observe Electric Postgres shape streams and wake on matching row changes (insert/update/delete). Includes server-side bridge management with cursor persistence, durable stream forwarding, and an `observe_pg_sync` tool for Horton agents.
- Updated dependencies [b8875a2]
  - @electric-sql/client@1.5.21

## 0.1.16

### Patch Changes

- 5238055: Show per-response token usage in the agent meta row, e.g. `1.2k ↑ 412
↓`. Updates as each step settles — for a single-turn call this lands
  once at done; for tool-using runs the counter jumps at each step
  boundary (the LLM SDK only emits `usage` at end-of-step, so we can't
  tick smoothly between tokens).

  Plumbing:
  - `StepValue` gains optional `input_tokens` / `output_tokens` columns
    (Zod + TS). Strictly additive: events recorded before this change
    stay valid since both fields are optional, so no migration.
  - `outbound-bridge.ts:onStepEnd` now persists the `tokenInput` /
    `tokenOutput` it already received from `pi-adapter.ts` — previously
    those values were accepted and silently dropped.
  - `EntityTimelineStepItem` / `IncludesStep` surface the new fields,
    and the three `.select()` blocks that materialize steps include
    them.
  - The cached `agent_response` section gets a `tokens?: { input?,
output? }` summed across the run's steps at section-build time, and
    the section-cache fingerprint factors in step token deltas so a
    late-arriving `onStepEnd` invalidates a stale section.

## 0.1.15

### Patch Changes

- 24d2c34: Show a clear sign-in prompt when connecting an Electric Cloud server while signed out instead of surfacing pull-wake runner registration errors.

## 0.1.14

### Patch Changes

- 7709c9a: Seed `@playwright/mcp` into the desktop's `settings.json mcp.servers`
  block on first launch — gives every new install browser automation
  out of the box. The default is opt-out friendly: after the seed runs,
  the entry behaves like any other settings.json MCP server (Edit,
  Remove, Disable all work normally), and removing it sticks across
  restarts thanks to a per-name `seededDefaultMcpServerNames` flag.
  Future built-in defaults can be added to `DEFAULT_MCP_SERVERS` in
  `settings/mcp-defaults.ts`; existing installs will pick them up on
  the next launch as long as the name isn't already recorded as seeded.
- f222d39: Add a form-based **Add / Edit / Remove** flow for MCP servers in the
  desktop's Settings → MCP Servers page. Before this, the only way to
  register a server was to hand-edit `settings.json` or a workspace
  `mcp.json`. The dialog supports both `http` and `stdio` transports, all
  four auth modes, and writes through to the global `settings.json
mcp.servers` block.

  The MCP page also gains provenance + shadowing awareness:
  - Entries from a workspace `mcp.json` render a "from mcp.json" badge
    and are read-only (no Edit/Remove). Lifecycle verbs still apply.
  - When a name in `settings.json` collides with one in workspace
    `mcp.json`, the workspace still wins (existing rule); the shadowed
    settings entry is rendered grayed-out next to the running workspace
    twin so the user can see what's been overridden.

  `BuiltinAgentsServer` gains a public `setExtraMcpServers(extras)` so
  the desktop can push add/edit/remove changes to the live MCP registry
  without restarting. Workspace `mcp.json` continues to win on name
  collision through the same merge path used by the file watcher.

- bbf52b6: Wire `electron-updater` so the desktop app can detect new releases. Phase
  one of two:
  - Adds a working **Check for Updates…** menu item (Electric Agents menu
    on macOS, Help menu on Windows/Linux, plus the in-window app-icon
    menu) and a quiet background check ~10s after launch.
  - On Windows/Linux, signed-platform flow is wired end-to-end: downloads
    in the background with a dock/taskbar progress bar, then prompts
    "Restart now" to apply via `quitAndInstall()`.
  - On macOS, ships as **notify-only** until Developer ID signing lands —
    Squirrel.Mac can't swap an unsigned bundle, so we skip the download
    entirely and prompt to open the GitHub releases page instead.
  - Switches the publish provider from `github` to `generic` pointed at
    the moving `agents-desktop-latest` tag, because the repo's overall
    "latest" release is shared across packages and the GitHub provider
    was picking the wrong one.
  - Adds channel separation so canary builds publish to the `beta`
    channel against an `agents-desktop-canary` URL — stable users never
    auto-update to canaries.

- 6e9e4a7: Show elapsed time while an agent is responding. While a turn is
  streaming, the meta row now ticks `Thinking · 12s` (or just `12s` once
  tokens start flowing). When a turn settles, the bare `✓ done` becomes
  `✓ done in 1m 5s` for turns completed in-session. Historical turns
  (already complete on page load) keep the bare label, since the client
  has no reliable completion timestamp for those — only the user message
  time, and subtracting `now()` would lie about the duration.
- 74d2341: Fix Codex auth for low-cost tool calls by passing fresh access tokens to URL extraction and worker tools.
- 9da7b8f: Install an Undici HTTP cache dispatcher for the built-in agents local Node runner so Durable Streams catch-up reads can use server cache headers. Electric Agents Desktop uses an on-disk SQLite cache so runtime restarts can reuse cached catch-up responses.
- 889fa20: Expose tenant-scoped users as an Electric shape and add a chat sharing dialog that grants user principals or all workspace users view, chat, or manage permissions over an entity. View/chat sharing includes fork access, forked chats are owned by the principal that creates the fork, shared chats can be identified and filtered by creator in the sidebar, and Cloud requests now inject the signed-in user as the Electric principal.

  Mobile now syncs the users and effective-permissions shapes, marks and filters shared chats by creator, disables native chat and signal controls when the current principal lacks permission, and shows the signed-in user principal on the Account screen for debugging.

## 0.1.13

### Patch Changes

- 17b374f: Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep), and `dockerSandbox()` (container isolation via `dockerode` as an optional peer dep).

  Built-in entities (Horton, Worker) default to `unrestrictedSandbox` via the new `chooseDefaultSandbox(workingDirectory)` helper. Stronger isolation is opt-in by constructing `dockerSandbox` or `remoteSandbox` directly — `dockerSandbox` is the recommended path for multi-entity hosting.

  Behavior changes folded in: bash no longer forwards `process.env` to children (removes the trivial `env`-dump leak of secrets like `$ANTHROPIC_API_KEY` — note the host-sharing `unrestricted` provider still can't fully contain secrets, e.g. via `/proc/<ppid>/environ`, so use `docker`/`remote` for untrusted or multi-tenant entities), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

  Runtimes advertise named **sandbox profiles** (e.g. `local`, `docker`) to the agents-server; spawn requests pick a profile by name, the server validates the choice against the target runner's advertised set, and the new-session UI surfaces a picker. Internally, the built-in tool factories (`createBashTool`, `createFetchUrlTool`, etc.) now route their filesystem and network access through the active `Sandbox`.

- 831c623: Clear stale Codex auth in the desktop app when no usable access token can be produced, preventing the UI from showing Codex as enabled while runs cannot authenticate.

## 0.1.12

### Patch Changes

- 7d029a9: Keep Electric Agents Desktop awake while the local runtime is active, with controls in Settings, onboarding, and the tray menu.
- Updated dependencies [ae2d039]
  - @electric-sql/client@1.5.20

## 0.1.11

### Patch Changes

- 0a15a47: Bundle the Electric CLI with the desktop app and add managed install/status UI.
- d921a9f: Allow desktop users to choose which configured provider models appear in Horton's model picker, and group model dropdown entries by provider.
- aed2189: Add Kimi / Moonshot API support for local Horton runtimes, including model catalog entries, runtime provider resolution, desktop credential persistence, and UI credential inputs.
- 7001f8f: Add a launch-at-login preference for Electric Agents Desktop, including background startup handling, settings/onboarding controls, and a shared Base UI switch control.

## 0.1.10

### Patch Changes

- 226cf15: Refactor the desktop main process into focused modules so Electron bootstrap, app state, credentials, runtime lifecycle, IPC, cloud auth, and UI shell responsibilities are easier to maintain.

## 0.1.9

### Patch Changes

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- 319e405: Explicit ChatGPT / Codex opt-in with native PKCE OAuth sign-in (opened in the user's default browser to avoid Cloudflare bot detection), per-source consent for detected Codex CLI / OpenCode logins, an inline "Use this login?" prompt under the new-session composer, and a "Restart local runtime" banner gated on credential changes. The runtime no longer reads `~/.codex/auth.json` implicitly — it now requires `ELECTRIC_CODEX_ACCESS_TOKEN` and honours `ELECTRIC_CODEX_REQUIRE_OPT_IN=1`.

## 0.1.8

### Patch Changes

- ac21b9a: Refine desktop agents onboarding and settings server management.

## 0.1.7

### Patch Changes

- a70567e: Add DeepSeek as a supported LLM provider.
  - `agents-runtime`: `detectAvailableProviders()` now detects `DEEPSEEK_API_KEY`; `deepseek` added to `AvailableProvider` type, `PREFERRED_IDS_BY_PROVIDER`, and `envCatalog()`
  - `agents`: model catalog probes `https://api.deepseek.com/v1/models` to surface available DeepSeek models (`deepseek-v4-flash`, `deepseek-v4-pro`); `deepseek-v4-flash` is the default fallback choice
  - `agents-desktop`: `ApiKeys` gains a `deepseek` field persisted in the keychain and mirrored to `DEEPSEEK_API_KEY` in the runtime environment
  - `agents-server-ui`: `ApiKeysForm` gains a DeepSeek API key input; `OnboardingModal` and `CredentialsPage` pass and persist the new field

## 0.1.6

### Patch Changes

- da26799: Add a runner picker to the new-session view so users can choose which pull-wake runner handles a spawned entity. Defaults to the Electron shell's own runner when it's one of the enabled choices (preserves the previous single-runtime behaviour) and falls back to the first enabled runner otherwise. The picker is only rendered when at least one runner is registered, so servers using webhook-based dispatch are unaffected. Also extends `Select.Trigger` with an optional `renderValue` prop so triggers can show a human-readable label when option values are opaque keys (e.g. runner ids).

## 0.1.5

### Patch Changes

- 1df4d63: Add CI workflows for desktop app build artifacts and canary publishing.
- d78075a: Restore the user's shell PATH in the packaged desktop app so CLI tools like `gh` are discoverable when launched from Finder or other GUI launchers.
- e6a0bff: Add configurable UI port via `ELECTRIC_DESKTOP_UI_PORT` env var for parallel desktop development. Include version in desktop artifact filename.

## 0.1.4

### Patch Changes

- e4acb1d: Use the Electric Cloud `service` query parameter for tenant-specific agents URLs so desktop cloud requests target the root agents endpoint while preserving tenant auth routing.
- e126eba: Route local desktop mutating agents-server requests through the Electron main process so CORS preflights cannot stall behind renderer connection limits.
- e126eba: Default unauthenticated local desktop sessions to the `system:dev-local` principal and resolve optimistic send principals at mutation time so pending messages do not render as `unknown`.
- e126eba: Add pull-wake runner health check endpoint and rename `owner_user_id` to `owner_principal` across the runners system. The `GET /_electric/runners/:id/health` endpoint returns comprehensive diagnostics including runner state, client-reported stream/heartbeat/claim metrics, active claims, and dispatch stats with a derived health status (healthy/degraded/unhealthy). The `PullWakeRunner` now tracks internal diagnostics and reports them to the server via heartbeats, stored in a separate `runner_runtime_diagnostics` table so the main `runners` shape stays stable for normal UI sync. The `owner_user_id` → `owner_principal` rename stores canonical principal URLs instead of keys, with strict validation and canonicalization at route boundaries. The migration expires active runner claims and deletes existing runner rows as part of the principal rewrite. This is a breaking change with no backward compatibility — all callers must send principal URLs.

## 0.1.3

### Patch Changes

- c4e046f: Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.

  Add first-launch onboarding for Electric Cloud sign-in and LLM API keys, plus a Cloud Agent Servers settings section that syncs the user's Cloud agent servers, mints per-tenant agents tokens in the main process, and connects the desktop runtime/UI to tenant-scoped Cloud agents URLs without exposing those tokens to the renderer or `settings.json`.

- 6aa0186: Add `ELECTRIC_DESKTOP_PRINCIPAL` env var for local development without auth. The desktop app injects the `electric-principal` header on all requests to the agents-server, enabling pull-wake runner registration and message sends to work locally. Also fix the UI to derive the optimistic message sender from the configured principal and stop sending the redundant `from` field in API requests.
- Updated dependencies [a15c7b6]
  - @electric-sql/client@1.5.18

## 0.1.2

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.

## 0.1.1

### Patch Changes

- dec65ae: Align desktop pull-wake runner registration with the effective request identity.
- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents@0.4.0
  - @electric-ax/agents-server-ui@0.4.0

## 0.1.0

### Minor Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.

### Patch Changes

- 590aabb: Improve the agents UI timeline and reactivity, add a browser-safe runtime client export, and route built-in agent metadata extraction through the configurable low-cost model runner.
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

- Updated dependencies [65f0cf0]
- Updated dependencies [f509387]
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [28d127b]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
  - @electric-ax/agents@0.3.0
  - @electric-ax/agents-server-ui@0.3.0
