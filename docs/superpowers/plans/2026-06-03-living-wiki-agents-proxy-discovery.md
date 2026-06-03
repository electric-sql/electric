# Living Wiki Agents Proxy Discovery

Date: 2026-06-03

Task: Phase 3 Task 1 discovery for `docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy.md`.

## Files and source inspected

- `packages/typescript-client/skills/electric-shapes/SKILL.md`
- `packages/typescript-client/skills/electric-proxy-auth/SKILL.md`
- `packages/agents-runtime/src/agents-client.ts`
- `packages/agents-runtime/src/runtime-server-client.ts`
- `packages/agents-runtime/src/observation-sources.ts`
- `packages/agents-runtime/src/entity-stream-db.ts`
- `packages/agents-runtime/src/types.ts`
- `packages/agents-server/src/routing/entities-router.ts`
- `packages/agents-server/src/routing/observations-router.ts`
- `packages/agents-server/src/routing/global-router.ts`
- `node_modules/.pnpm/@durable-streams+client@0.2.6/node_modules/@durable-streams/client/dist/index.js`
- `node_modules/.pnpm/@durable-streams+client@0.2.6/node_modules/@durable-streams/client/dist/index.d.cts`
- `examples/deep-survey/src/ui/hooks/useSwarm.ts`
- `examples/deep-survey/src/server/index.ts`
- `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`
- `docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md`
- `docs/superpowers/plans/2026-06-03-living-wiki-api-boundary.md`
- `examples/living-wiki/src/worker/env.ts`
- `examples/living-wiki/src/worker/routes.ts`
- `examples/living-wiki/src/worker/trpc-router.ts`
- `examples/living-wiki/src/app/api/livingWikiApi.ts`
- `examples/living-wiki/README.md`
- `packages/agents/skills/quickstart.md`
- `examples/deep-survey/src/server/orchestrator.ts`

Helpful greps from the plan were run against `packages/agents-runtime`, `packages/agents`, `packages/agents-server`, `packages/typescript-client`, durable-streams packages, and `examples/deep-survey`.

## 1. Confirmed upstream Agents runtime paths

Confirmed in `packages/agents-runtime/src/runtime-server-client.ts` and matching server route definitions.

### Entity control-plane and entity metadata

`entityRpcPath(entityUrl, suffix = '')` returns:

```text
/_electric/entities${entityUrl}${suffix}
```

For an entity URL such as `/orchestrator/demo`, the runtime paths are therefore:

- `GET /_electric/entities/:type/:instanceId` — `getEntity(entityUrl)` returns entity metadata including `streams.main`.
- `PUT /_electric/entities/:type/:instanceId` — `spawnEntity({ type, id, ... })`.
- `POST /_electric/entities/:type/:instanceId/send` — `sendEntityMessage({ targetUrl, payload, type?, afterMs?, mode?, position? })`.
- `POST /_electric/entities/:type/:instanceId/signal` — `signalEntity({ entityUrl, signal, reason?, payload? })`.
- Other routes exist in `entities-router.ts` (`attachments`, `inbox`, `fork`, `tags`, `schedules`, `event-source-subscriptions`) but are broader than needed for this phase.

### Entity stream

There is no special `/_electric/entities/.../main` stream route in the server router. `createAgentsClient.observe(entity(entityUrl))` does this instead:

1. Calls `GET /_electric/entities${entityUrl}`.
2. Reads `streams.main` from the JSON response.
3. Calls `createEntityStreamDB(appendPathToUrl(baseUrl, info.streamPath))`.

The Deep Survey example bypasses the metadata lookup and directly uses:

```ts
const streamUrl = `${baseUrl}${entityUrl}/main`
createEntityStreamDB(streamUrl)
```

That implies entity main stream paths may be ordinary durable-stream paths like `/:type/:id/main`, not nested under `/_electric/entities`. For proxy implementation, the safest option is for the Worker to resolve a Living Wiki entity target server-side and either:

- call `GET /_electric/entities/:type/:id` server-side and use returned `streams.main`, or
- derive the known `/:type/:id/main` stream path only if Living Wiki owns that entity URL convention.

Do not let the browser provide `entityUrl` or `streamPath`.

### Observations ensure-stream

Confirmed in `runtime-server-client.ts` and `observations-router.ts`:

- `POST /_electric/observations/entities/ensure-stream`
  - body: `{ "tags": Record<string, string> }`
  - response: `{ "streamUrl": string, "sourceRef": string }`
- `POST /_electric/observations/cron/ensure-stream`
  - body: `{ "expression": string, "timezone"?: string }`
  - response: `{ "streamUrl": string }`

`createAgentsClient.observe(entities({ tags }))` calls `ensureEntitiesMembershipStream(tags)` and then observes the source's already-derived `streamUrl`.

### Shared-state stream

Confirmed in `runtime-server-client.ts`, `observation-sources.ts`, and `global-router.ts`:

- `getSharedStateStreamPath(sharedStateId)` returns `/_electric/shared-state/${sharedStateId}`.
- `db(id, schema)` uses that path as `streamUrl`.
- `ensureSharedStateStream(id)` sends `PUT /_electric/shared-state/:id` with `content-type: application/json`.
- `globalRouter.all('/_electric/shared-state/*', durableStreamsRouter.fetch)` sends shared-state reads/writes to Durable Streams.

For browser observation, only `GET /_electric/shared-state/:id?...` needs proxying if the stream already exists. `PUT` ensure/create should remain server-side unless a future phase needs it.

## 2. Confirmed browser client APIs and URL derivation

From `agents-client.ts`:

- `createAgentsClient({ baseUrl, fetch?, principalKey? })` builds a runtime server client against `baseUrl`.
- `client.observe(entity(entityUrl))` calls runtime metadata at `baseUrl + /_electric/entities${entityUrl}`, then creates `createEntityStreamDB(baseUrl + streams.main)`.
- `client.observe(entities({ tags }))` calls `POST baseUrl + /_electric/observations/entities/ensure-stream`, then creates `createStreamDB({ streamOptions: { url: baseUrl + source.streamUrl, contentType: 'application/json' }, ... })`.
- `client.observe(db(id, schema))` creates `createStreamDB({ streamOptions: { url: baseUrl + /_electric/shared-state/:id, contentType: 'application/json' }, ... })`.
- `client.signal(...)` and `client.kill(...)` call `POST baseUrl + /_electric/entities${entityUrl}/signal`.

From `examples/deep-survey/src/ui/hooks/useSwarm.ts`:

- Browser code uses `createAgentsClient({ baseUrl: darixUrl })` and then `client.observe(entities({ tags: { swarm_id } }))`.
- Browser code directly creates an entity DB for the orchestrator at `${darixUrl}/orchestrator/${swarmId}/main`.
- Browser code observes shared state with `client.observe(db(m.id, swarmSharedSchema))` once the orchestrator manifest exposes a shared-state id.

For Living Wiki, using `createAgentsClient` directly from the browser is not compatible with the desired security boundary unless `baseUrl` is the Living Wiki Worker and the Worker exposes compatibility routes. A narrower browser wrapper around safe Worker routes is preferable for this phase.

## 3. Stream query params to forward

Agents stream reads use `@durable-streams/client`, not Electric Shapes' shape protocol.

Confirmed durable-streams query parameters in `@durable-streams/client`:

- `offset` — always sent; initial default is `-1`; subsequent requests use the last `Stream-Next-Offset`.
- `live` — sent as `long-poll` for long polling once up-to-date, or `sse` for SSE mode.
- `cursor` — echoed from `Stream-Cursor` when present.

`createStreamDB` / `createEntityStreamDB` may also pass application `params` from `streamOptions`, but the Agents usage inspected does not require browser-controlled params for entity, entities-membership, or shared-state observation. Living Wiki should not forward arbitrary durable-stream `params`.

Recommended allowlist for Agents stream GET proxy:

```text
offset, live, cursor
```

Recommended value restrictions:

- `offset`: opaque string; forward if present, otherwise let the upstream/client default behavior occur. Do not parse as a number.
- `live`: allow only `long-poll` and `sse` if SSE is supported through the Worker. If not testing SSE in this phase, allow only `long-poll` and omit/reject `sse`.
- `cursor`: opaque string from `Stream-Cursor`; forward if present.

Do not forward Electric Shape params such as `table`, `where`, `params[...]`, `columns`, `handle`, `live_sse`, `subset__*`, etc. Those are from `@electric-sql/client` shape protocol, not the durable-streams Agents stream protocol confirmed here.

## 4. Response headers browser stream clients need exposed

`@durable-streams/client` reads these response headers from `Response.headers`:

- `Stream-Next-Offset`
- `Stream-Cursor`
- `Stream-Up-To-Date`
- `Stream-Closed`
- `stream-sse-data-encoding`
- `content-type`

For cross-origin browser use, expose at least:

```text
Stream-Next-Offset, Stream-Cursor, Stream-Up-To-Date, Stream-Closed, stream-sse-data-encoding
```

If Living Wiki app and Worker are same-origin, CORS exposure is less important, but the proxy sanitizer can still set `Access-Control-Expose-Headers` narrowly when used.

Per Electric proxy-auth guidance, proxied responses should unconditionally delete:

```text
content-encoding, content-length
```

## 5. Request headers and auth/principal behavior

Confirmed in `runtime-server-client.ts`:

- `principalKey` is sent as request header `electric-principal`.
- `headers` from client config are merged into request headers.
- `writeTokenHeader` support exists for tag mutation helpers: token can be sent as `authorization: Bearer <token>`, `electric-claim-token: <token>`, or both. This is for write-token operations, not needed for browser stream observation in this phase.
- Most JSON control-plane calls explicitly set `content-type: application/json`.

No evidence was found that browser stream GETs need to send any client-supplied auth headers. Recommended browser request-header allowlist for stream proxy is empty, or at most safe non-secret headers required by platform CORS. Do not forward browser `authorization`, cookies, `electric-principal`, `electric-claim-token`, `host`, `x-forwarded-*`, or arbitrary `stream-*`/`electric-*` headers.

The Worker should inject upstream credentials/principal server-side if configured. Candidate env names should remain Living Wiki-specific, e.g. `ELECTRIC_AGENTS_BASE_URL`, `ELECTRIC_AGENTS_TOKEN`, and optional `ELECTRIC_AGENTS_PRINCIPAL_KEY`. The exact token header for the deployed upstream was not proven by this discovery; implement the minimal explicit behavior and tests, and do not expose these values in health/config JSON.

## 6. Current Living Wiki code impact on route/env/client-wrapper decisions

The current Living Wiki scaffold/API-boundary files confirm that the browser already talks only to the Worker through application-owned routes and a typed REST wrapper:

- `env.ts` currently exposes scaffold-era Electric Cloud settings (`ELECTRIC_CLOUD_API_URL`, optional `ELECTRIC_CLOUD_API_TOKEN`, `ELECTRIC_AGENTS_SPACE_ID`) plus `APP_ENV` and seeded-demo flags. Agents stream proxy work should add separate upstream Agents runtime settings (for example `ELECTRIC_AGENTS_BASE_URL`, optional token/principal settings) rather than repurposing the Cloud API URL, because Durable Streams/Agents runtime routes are not the same surface as the Electric Cloud management API.
- `routes.ts` already owns `/api/health`, `/api/spaces`, `/api/spaces/:wikiSpaceId/join`, and `/api/spaces/:wikiSpaceId`. New observe/proxy routes should stay under `/api/...`, avoid those existing paths, and preserve the current JSON error style for non-stream REST routes.
- `trpc-router.ts` mirrors the WikiSpace create/join/get commands behind `space.*` procedures and keeps `health`. Agents stream observation should not be added as broad tRPC pass-through because durable-stream reads need header/query sanitization and streaming response handling; narrow tRPC commands can be added later only for validated non-stream commands.
- `livingWikiApi.ts` is a REST client wrapper that validates Worker JSON snapshots with shared schemas and constructs only app-owned URLs. The Agents browser wrapper should follow this pattern: build safe Living Wiki URLs, validate app-level inputs such as `wikiSpaceId`/entity kind, and never accept raw upstream `/_electric/...`, `entityUrl`, `streamPath`, tags, or secret headers from callers.
- `README.md` documents the Worker as the browser security boundary and explicitly says Electric Cloud token values must not appear in browser code or JSON responses. The same rule applies to any Agents runtime token/principal env.

Recommendation impact: no locked route/scope changes were needed. Env recommendations are clarified to add Agents runtime env names alongside the existing Cloud env rather than replacing the scaffold's current `ELECTRIC_CLOUD_*` management settings.

## 7. Quickstart and Deep Survey orchestrator findings

`packages/agents/skills/quickstart.md` confirms the intended Agents programming model: entity types are defined with `registry.define()`, entity instances are addressed by URLs such as `/perspectives/test-1`, server code can use `createRuntimeServerClient()` for spawn/send operations, and frontend code can use `createAgentsClient`, `entity(url)`, and `useChat` to observe durable entity streams. It also confirms that the browser examples subscribe to specific entity streams rather than sending arbitrary runtime control-plane requests.

`examples/deep-survey/src/server/orchestrator.ts` confirms a concrete manager/worker shape relevant to Living Wiki: an `orchestrator` entity derives its entity id from `ctx.entityUrl`, creates a deterministic shared-state id (`wiki-swarm-${entityId}`), calls `ctx.mkdb(...)` on first wake, observes that shared state with `ctx.observe(db(...))`, spawns child entities with `ctx.spawn(type, id, args, { initialMessage, wake: 'runFinished', tags })`, and uses tags such as `swarm_id` for membership/group observation. This supports deriving Living Wiki observe tags server-side from `wikiSpaceId` and using deterministic shared-state ids until they can be resolved from a WikiSpace record.

Entity-kind impact: the examples support simple lower-case entity types such as `orchestrator`, `worker`, and app-specific worker types. For Living Wiki public routes, keep `entityKind` as a Living Wiki allowlisted enum mapped server-side to real Agents types; do not let the browser choose arbitrary upstream entity types.

Send/tRPC impact: quickstart Step 4 uses a server route plus `createRuntimeServerClient().spawnEntity(...)` for privileged actions, reinforcing the recommendation to expose narrow app command routes instead of broad browser tRPC/control-plane proxying. If Living Wiki later needs send/spawn, it should remain a validated Worker-side command that computes target URLs.

Observe route-shape impact: quickstart frontend examples and Deep Survey's shared-state/orchestrator flow reinforce the three safe observe cases already identified: specific entity stream, entities-by-server-derived-tags stream, and deterministic/resolved shared-state stream. No recommendation changes were needed beyond documenting that Living Wiki should derive tags and shared-state ids server-side.

## 8. Recommended locked public Worker route shape for Tasks 2+

Use safe Living Wiki routes that encode intent, not upstream paths:

- `GET /api/agents/entities/:wikiSpaceId/:entityKind/:entityId/stream`
  - Worker resolves `entityKind/entityId` to a Living Wiki entity URL and upstream main stream path.
  - Proxy only durable-stream query params `offset`, `live`, `cursor`.

- `GET /api/observe/:wikiSpaceId/entities`
  - Worker derives membership tags server-side, e.g. `{ wiki_space_id: wikiSpaceId }`.
  - Worker ensures `POST /_electric/observations/entities/ensure-stream` server-side as needed, then proxies the resulting stream path.
  - Do not allow browser-provided tags, `where`, `select`, or source refs.

- `GET /api/observe/:wikiSpaceId/shared-state`
  - Worker derives a deterministic phase-placeholder shared-state id server-side from `wikiSpaceId`, or later resolves it from a server-side WikiSpace record.
  - Proxies `/_electric/shared-state/:derivedId` stream GET with only `offset`, `live`, `cursor`.

Optional compatibility/ensure route:

- `POST /api/observe/:wikiSpaceId/entities/ensure`
  - Only if browser wrapper needs an explicit ensure step. Prefer hiding ensure inside the GET proxy so the browser only observes a safe route.

Avoid exposing public routes that mirror arbitrary `/_electric/...` paths.

## 9. Non-streaming send/tRPC scope recommendation

Defer non-streaming `send`, `signal`, spawn, attachments, tags, schedules, and broad tRPC/control-plane proxying unless a concrete Living Wiki UI flow in this phase requires them.

If `send` is included, expose only a narrow Living Wiki command route such as:

- `POST /api/agents/entities/:wikiSpaceId/:entityKind/:entityId/send`

Validate a small shared body schema, normalize it server-side to the confirmed upstream `sendEntityMessage` body (`payload`, optional `type`, `afterMs`, `mode`, `position`), and never accept raw upstream `targetUrl` from the browser.

## 10. Uncertainty / blockers

No implementation blocker for stream proxying was found.

Open uncertainties to treat conservatively:

- The deployed upstream token/header contract for Living Wiki Agents was not identifiable from the inspected files. The runtime client supports arbitrary config headers, `electric-principal`, and write-token helpers, but does not prescribe a single environment variable or auth header for all upstream calls.
- Entity main stream path convention can be discovered at runtime through `GET /_electric/entities/:type/:id` and `streams.main`; this is safer than hard-coding `/:type/:id/main` unless Living Wiki owns the entity type/id convention.
- SSE (`live=sse`) is supported by durable-streams client, but Worker streaming/SSE behavior should be tested before allowing it. Long-poll (`live=long-poll`) is the safer initial allowlist.
