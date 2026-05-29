# @electric-ax/agents-server-ui

## 0.4.12

### Patch Changes

- 0ba0a43: Refactor the new-session prompt form. Move the working-directory and runner pickers out of the composer's inline pill row into a "session context" tray that tucks under the composer's curved bottom edge (mirrors the chat screen's `<EntityContextDrawer>` pattern, just flipped). Give the runner picker visual parity with the working-directory picker via a new optional leading-icon slot on `Select.Trigger`, and reword the working-directory "None" option to "Don't work in a directory".

## 0.4.11

### Patch Changes

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- c1834f3: Prepare the mobile app for Expo EAS builds and CI. Adds dynamic Expo config, EAS build profiles, mobile CI/export scripts, and aligns shared React/TypeScript dependency resolution so the Expo DOM embed typechecks and passes `expo-doctor`.
- 319e405: Explicit ChatGPT / Codex opt-in with native PKCE OAuth sign-in (opened in the user's default browser to avoid Cloudflare bot detection), per-source consent for detected Codex CLI / OpenCode logins, an inline "Use this login?" prompt under the new-session composer, and a "Restart local runtime" banner gated on credential changes. The runtime no longer reads `~/.codex/auth.json` implicitly — it now requires `ELECTRIC_CODEX_ACCESS_TOKEN` and honours `ELECTRIC_CODEX_REQUIRE_OPT_IN=1`.
- Updated dependencies [d344c32]
- Updated dependencies [c1834f3]
- Updated dependencies [319e405]
  - @electric-ax/agents-runtime@0.3.5

## 0.4.10

### Patch Changes

- ac21b9a: Refine desktop agents onboarding and settings server management.

## 0.4.9

### Patch Changes

- Updated dependencies [833a1cb]
- Updated dependencies [833a1cb]
  - @electric-ax/agents-runtime@0.3.4

## 0.4.8

### Patch Changes

- b39f581: Fix Agent UI message submission on mobile browsers. The Send button now keeps the textarea focused on tap so the on-screen keyboard does not dismiss and reflow the viewport mid-click, and the composer recognises the soft-keyboard return key via `enterKeyHint="send"` plus a `beforeinput` fallback (Android Chrome / GBoard route it as `insertLineBreak` without a matching `keydown`). The Enter handler now also ignores IME composition (`keyCode === 229`).
- a70567e: Add DeepSeek as a supported LLM provider.
  - `agents-runtime`: `detectAvailableProviders()` now detects `DEEPSEEK_API_KEY`; `deepseek` added to `AvailableProvider` type, `PREFERRED_IDS_BY_PROVIDER`, and `envCatalog()`
  - `agents`: model catalog probes `https://api.deepseek.com/v1/models` to surface available DeepSeek models (`deepseek-v4-flash`, `deepseek-v4-pro`); `deepseek-v4-flash` is the default fallback choice
  - `agents-desktop`: `ApiKeys` gains a `deepseek` field persisted in the keychain and mirrored to `DEEPSEEK_API_KEY` in the runtime environment
  - `agents-server-ui`: `ApiKeysForm` gains a DeepSeek API key input; `OnboardingModal` and `CredentialsPage` pass and persist the new field

- d7506a2: Add mobile agent signal controls. The mobile chat composer now shows a stop control while a run is active, the session menu exposes all entity signal types in a child menu, and the embedded chat timeline accounts for the native composer/drawer inset with aligned message widths and bottom fade masking.
- 86e69d5: Add defensive null guards for timeline run items and an error boundary around each timeline row to prevent a single malformed row from crashing the entire view.
- Updated dependencies [9c2c3ae]
- Updated dependencies [a70567e]
- Updated dependencies [b3d4f02]
- Updated dependencies [dffbf62]
  - @electric-ax/agents-runtime@0.3.3

## 0.4.7

### Patch Changes

- e13cad1: Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
- da26799: Add a runner picker to the new-session view so users can choose which pull-wake runner handles a spawned entity. Defaults to the Electron shell's own runner when it's one of the enabled choices (preserves the previous single-runtime behaviour) and falls back to the first enabled runner otherwise. The picker is only rendered when at least one runner is registered, so servers using webhook-based dispatch are unaffected. Also extends `Select.Trigger` with an optional `renderValue` prop so triggers can show a human-readable label when option values are opaque keys (e.g. runner ids).
- 4d9c36e: Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.
- Updated dependencies [e13cad1]
- Updated dependencies [4d9c36e]
  - @electric-ax/agents-runtime@0.3.2

## 0.4.6

### Patch Changes

- ca01b9d: Add the React Native agents mobile app package.
- 64d9354: Connect the Electric mobile app to Electric Cloud agent servers end-to-end. Trade the dashboard JWT for a per-service agents token, inject `Authorization`/`x-electric-service`/`electric-principal` on every outbound request (via `serverFetch` + `fetchClient` on shape collections, including the React Native long-poll `DurableStream`), forward those headers across the Expo DOM-embed boundary as a prop so the embed's own `auth-fetch` instance picks them up, switch URL composition to `appendPathToUrl` (Cloud URLs carry `?service=…`), spawn via the canonical `/_electric/entities/<type>/<name>` endpoint with `initialMessage` in the body (fixes a STREAM_NOT_FOUND race), and add a runner picker so users target a specific pull-wake runner.
- Updated dependencies [ca01b9d]
- Updated dependencies [9f10b20]
  - @electric-ax/agents-runtime@0.3.1

## 0.4.5

### Patch Changes

- e6a0bff: Add configurable UI port via `ELECTRIC_DESKTOP_UI_PORT` env var for parallel desktop development. Include version in desktop artifact filename.
- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.
- Updated dependencies [9c275b7]
- Updated dependencies [1ab43f5]
- Updated dependencies [99ac6fd]
- Updated dependencies [adc99e9]
  - @electric-ax/agents-runtime@0.3.0

## 0.4.4

### Patch Changes

- e126eba: Route local desktop mutating agents-server requests through the Electron main process so CORS preflights cannot stall behind renderer connection limits.
- e126eba: Default unauthenticated local desktop sessions to the `system:dev-local` principal and resolve optimistic send principals at mutation time so pending messages do not render as `unknown`.
- e126eba: Send new-session initial messages through the spawn request so pull-wake sessions can start without waiting for the UI to preload the entity stream.
- Updated dependencies [e126eba]
- Updated dependencies [e126eba]
  - @electric-ax/agents-runtime@0.2.2

## 0.4.3

### Patch Changes

- c4e046f: Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.

  Add first-launch onboarding for Electric Cloud sign-in and LLM API keys, plus a Cloud Agent Servers settings section that syncs the user's Cloud agent servers, mints per-tenant agents tokens in the main process, and connects the desktop runtime/UI to tenant-scoped Cloud agents URLs without exposing those tokens to the renderer or `settings.json`.

- 6aa0186: Add `ELECTRIC_DESKTOP_PRINCIPAL` env var for local development without auth. The desktop app injects the `electric-principal` header on all requests to the agents-server, enabling pull-wake runner registration and message sends to work locally. Also fix the UI to derive the optimistic message sender from the configured principal and stop sending the redundant `from` field in API requests.

## 0.4.2

## 0.4.1

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
- Updated dependencies [dfc9a45]
- Updated dependencies [83204d9]
  - @electric-ax/agents-runtime@0.2.1

## 0.4.0

### Minor Changes

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

### Patch Changes

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents-runtime@0.2.0

## 0.3.0

### Minor Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.

### Patch Changes

- f509387: Redesign.
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

- a3cee92: Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [744c47f]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
  - @electric-ax/agents-runtime@0.1.3

## 0.2.8

### Patch Changes

- d13820e: Tune the agents server UI accent colors and restore readable dark-mode code snippets.
- c0037aa: fix: update the ui

## 0.1.6

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2

## 0.1.5

### Patch Changes

- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.1.4

### Patch Changes

- 89debcf: Coder-session UI improvements: a dedicated 3-tab Create / Attach / Import spawn dialog routed in from the sidebar's _New session_ flow, a timeline view that shows queued user prompts immediately as a "queued" bubble (matched against canonical `user_message` events by text so they swap cleanly when the CLI mirrors the JSONL back), and a session header that surfaces the full `nativeSessionId` for copy/paste against on-disk session files.
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.1.3

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.1.2

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.1.1

### Patch Changes

- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
