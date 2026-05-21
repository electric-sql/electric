# @electric-ax/agents-server-conformance-tests

## 0.1.7

### Patch Changes

- e13cad1: Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
- 4d9c36e: Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.

## 0.1.6

### Patch Changes

- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.

## 0.1.5

### Patch Changes

- 47f17f1: Route Durable Streams subscription control traffic through the reserved `__ds` prefix under each stream URL. Agents-server now accepts control routes at the server-root `__ds` prefix, proxies them before normal stream operations, and forwards Durable Streams requests through the resolved tenant stream root instead of inferring cloud-specific URL shapes.
- Updated dependencies [a15c7b6]
  - @electric-sql/client@1.5.18

## 0.1.4

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.

## 0.1.3

### Patch Changes

- 443482a: Prepare the agents server and server conformance test packages for public npm publication.

  The agents server package now publishes its Drizzle migration files alongside the built entrypoints so installed servers can run database migrations outside the monorepo.

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

## 0.1.2

### Patch Changes

- 744c47f: Replace static entity write tokens with claim-scoped tokens. Write tokens are now issued when a consumer claims a wake and revoked on done, preventing leaked credentials from granting permanent write access. Removes `writeToken` from webhook notifications and spawn response headers.
- Updated dependencies [92a332e]
  - @electric-sql/client@1.5.17

## 0.1.1

### Patch Changes

- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
