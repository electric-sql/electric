# electric-ax

## 0.2.1

### Patch Changes

- dfc9a45: Remove obsolete identity header plumbing from the Electric Agents CLI.
- Updated dependencies [dfc9a45]
- Updated dependencies [83204d9]
  - @electric-ax/agents-runtime@0.2.1
  - @electric-ax/agents@0.4.1

## 0.2.0

### Minor Changes

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

### Patch Changes

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents@0.4.0
  - @electric-ax/agents-runtime@0.2.0

## 0.1.18

### Patch Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.
- 590aabb: Improve the agents UI timeline and reactivity, add a browser-safe runtime client export, and route built-in agent metadata extraction through the configurable low-cost model runner.
- b16ef14: fix: don't show a stale error before the first API key prompt when no key is configured
- Updated dependencies [65f0cf0]
- Updated dependencies [f509387]
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [744c47f]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
- Updated dependencies [92a332e]
  - @electric-ax/agents@0.3.0
  - @electric-ax/agents-runtime@0.1.3
  - @electric-sql/client@1.5.17

## 0.1.17

### Patch Changes

- 4d50347: Bind the local built-in agents server to all interfaces by default so Docker-backed quickstart coordinators can reach Horton webhooks via host.docker.internal.

## 0.1.16

### Patch Changes

- 1aec196: feat: CLI quickstart readability and clarity improvements
- Updated dependencies [1aec196]
  - @electric-ax/agents@0.2.4

## 0.1.15

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2
  - @electric-sql/client@1.5.16
  - @electric-ax/agents@0.2.3

## 0.1.14

### Patch Changes

- 5fec5f1: Replace the abrupt `ANTHROPIC_API_KEY is required` fatal error in `agents quickstart` and `agents start-builtin` with a friendly interactive prompt that explains how the key is used (it never leaves the local machine) and lets the user choose between setting up `.env` manually or pasting the key once to have the CLI write `.env` for them. Non-interactive runs still fail fast with the original error.

## 0.1.13

### Patch Changes

- b0af010: Fix CLI command references and package dependencies for agents chat starter.
- Updated dependencies [4d8e452]
- Updated dependencies [b0af010]
- Updated dependencies [b0af010]
  - @electric-ax/agents@0.2.2

## 0.1.12

### Patch Changes

- 125c276: Improve Horton's onboarding: add warm greeting for initial messages and present multiple onboarding paths instead of defaulting to the quickstart skill.
- Updated dependencies [125c276]
- Updated dependencies [e0b588f]
  - @electric-ax/agents@0.2.1
  - @electric-ax/agents-runtime@0.1.1

## 0.1.11

### Patch Changes

- Updated dependencies [89debcf]
- Updated dependencies [491ba04]
- Updated dependencies [4fc022b]
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents@0.2.0
  - @electric-ax/agents-runtime@0.1.0

## 0.1.10

### Patch Changes

- Updated dependencies [4801e76]
  - @electric-ax/agents@0.1.5

## 0.1.9

### Patch Changes

- 1d6e728: fix: ensure docker-compose has a correct reference

## 0.1.8

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4
  - @electric-ax/agents@0.1.4

## 0.1.7

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3
  - @electric-ax/agents@0.1.3

## 0.1.6

### Patch Changes

- 7652bdc: Block `electric agent quickstart` before startup when no Anthropic API key is available.

## 0.1.5

### Patch Changes

- Updated dependencies [1786ee6]
  - @electric-ax/agents@0.1.2

## 0.1.4

### Patch Changes

- 097f2c4: Fix postgres 18 docker volume mount path to use `/var/lib/postgresql` instead of `/var/lib/postgresql/data`
- Updated dependencies [097f2c4]
- Updated dependencies [46e0a75]
  - @electric-ax/agents-runtime@0.0.2
  - @electric-ax/agents@0.1.1

## 0.1.3

### Patch Changes

- 196d55b: Fix postgres 18 docker volume mount path to use `/var/lib/postgresql` instead of `/var/lib/postgresql/data`

## 0.1.2

### Patch Changes

- 3026244: fix: packaging was missing builtin agents start script due to a split

## 0.1.1

### Patch Changes

- 2cc77cb: fix: ensure stable name for the started service
