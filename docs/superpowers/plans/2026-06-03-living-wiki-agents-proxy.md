# Living Wiki Electric Agents Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a secure, Worker-side Electric Agents proxy and browser observe boundary for Living Wiki. The browser must call only Living Wiki Worker routes; the Worker must inject Electric Agents runtime URL, token/principal/server config, and all target selection server-side. This phase proves the boundary with tests and narrow client wrappers, without implementing full Living Wiki entity orchestration, shared-state schema generation, or graph/intake/review flows.

**Architecture:** Add a Worker `agents-proxy` adapter that forwards only allowlisted Electric Agents runtime control-plane, entity-stream, and shared-state observe requests to the configured upstream. Add explicit Living Wiki target resolvers so the browser can request only known space-scoped observations or non-streaming commands. Apply Electric shape proxy-auth rules to Agents `/_electric/entities/*`, `/_electric/observations/*`, `/_electric/shared-state/*`, and stream observe calls: never forward arbitrary client query/body/headers, inject auth only server-side, strip decompression-sensitive response headers, and expose required observe protocol headers only when needed by browser stream clients.

**Tech Stack:** TypeScript, Cloudflare Workers/Wrangler, tRPC, REST, Vitest, `@electric-ax/agents-runtime` / `@electric-ax/agents-runtime/client` APIs as confirmed from repo source, existing Living Wiki scaffold and API boundary modules.

---

## Scope

This phase implements and tests the security boundary for Electric Agents access only. It may proxy observed entity/shared-state streams and carefully scoped non-streaming entity commands if the APIs are confirmed. It must not create Living Wiki role entities, digest sources, generate graph data, implement review orchestration, or expose broad Electric Agents administrative capabilities to the browser.

## Required pre-work

- [ ] Read `packages/typescript-client/skills/electric-shapes/SKILL.md`.
- [ ] Read `packages/typescript-client/skills/electric-proxy-auth/SKILL.md`.
- [ ] Apply the shape proxy-auth principles to Electric Agents routes:
  - browser URLs point to Living Wiki Worker proxy routes, not Electric Agents upstream URLs;
  - Worker decides the upstream target and injects any token/principal/server config server-side;
  - only protocol/observe query parameters required by stream clients are forwarded;
  - browser cannot choose arbitrary upstream entity, space, shared-state id, observation target, table, collection, or path;
  - proxied upstream responses delete `content-encoding` and `content-length`;
  - CORS exposes only required stream/observe headers if browser code must read them;
  - tests prove no token or secret config appears in JSON, response headers, redirected URLs, or proxied bodies created by the Worker.
- [ ] Read current Living Wiki docs/plans:
  - `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`
  - `docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-api-boundary.md`
- [ ] Inspect current Living Wiki code before editing:
  - `examples/living-wiki/src/worker/env.ts`
  - `examples/living-wiki/src/worker/routes.ts`
  - `examples/living-wiki/src/worker/trpc-router.ts`
  - `examples/living-wiki/src/app/api/livingWikiApi.ts`
  - `examples/living-wiki/README.md`
- [ ] Inspect relevant Electric Agents examples/APIs before implementing:
  - `examples/deep-survey/src/ui/hooks/useSwarm.ts`
  - `examples/deep-survey/src/server/index.ts`
  - `examples/deep-survey/src/server/orchestrator.ts`
  - `packages/agents/skills/quickstart.md`
  - `packages/agents-runtime/src/agents-client.ts`
  - `packages/agents-runtime/src/runtime-server-client.ts`
  - `packages/agents-runtime/src/observation-sources.ts`

## Key findings from planning inspection

- Browser examples currently use `createAgentsClient({ baseUrl })`, then `client.observe(entities({ tags }))`, `client.observe(db(id, schema))`, and direct `createEntityStreamDB(baseUrl + entityUrl + '/main')` for entity streams.
- Runtime client paths observed in source include `/_electric/entities/:type/:id`, `/_electric/entities/<entityUrl>/send`, `/_electric/entities/<entityUrl>/signal`, `/_electric/observations/entities/ensure-stream`, and `/_electric/shared-state/:id`.
- `createAgentsClient.observe(db(...))` ultimately fetches the stream URL from `source.streamUrl`; for browser use behind this Worker, client `baseUrl` and/or wrapped fetch must point at Worker proxy endpoints.
- Exact stream query/header protocol requirements are not fully documented in the inspected files. The implementation must start with a discovery task and write adapter constants from real client/runtime behavior rather than guessing.

## File structure after this plan

Existing files retained and modified where listed:

```text
examples/living-wiki/
  README.md                                      # modify: document proxy boundary and commands
  src/app/api/livingWikiApi.ts                   # modify: add proxy client helpers if appropriate
  src/worker/env.ts                              # modify: add typed Agents upstream env
  src/worker/routes.ts                           # modify: route REST proxy endpoints
  src/worker/trpc-router.ts                      # modify: add non-streaming command procedures only if appropriate
```

Create these files:

```text
examples/living-wiki/src/shared/agents-proxy.ts
examples/living-wiki/src/shared/agents-proxy.test.ts
examples/living-wiki/src/app/api/agentsProxyApi.ts
examples/living-wiki/src/app/api/agentsProxyApi.test.ts
examples/living-wiki/src/worker/agents-proxy/allowlists.ts
examples/living-wiki/src/worker/agents-proxy/allowlists.test.ts
examples/living-wiki/src/worker/agents-proxy/targets.ts
examples/living-wiki/src/worker/agents-proxy/targets.test.ts
examples/living-wiki/src/worker/agents-proxy/proxy.ts
examples/living-wiki/src/worker/agents-proxy/proxy.test.ts
examples/living-wiki/src/worker/agents-proxy/routes.ts
examples/living-wiki/src/worker/agents-proxy/routes.test.ts
```

Only add further files if the discovery task proves the repo's actual Agents APIs require a different split; record the reason in the implementation summary.

## Public Worker API shape for this phase

Use safe Living Wiki route names that do not mirror arbitrary upstream paths. The route names and `EntityKind`/`ObserveKind` values below are candidate placeholders until Task 1 discovery confirms compatibility with `createAgentsClient`, `createStreamDB`, and `createEntityStreamDB`; lock the confirmed route shape before implementing Tasks 2+:

- `GET /api/agents/entities/:wikiSpaceId/:entityKind/:entityId/stream`
  - Proxies the main stream for an allowlisted Living Wiki entity URL after resolving `wikiSpaceId`, `entityKind`, and `entityId` through `targets.ts`.
  - The browser never provides `/_electric/...` or `/type/id/main` directly.
- `POST /api/agents/entities/:wikiSpaceId/:entityKind/:entityId/send`
  - Optional in this phase, only if confirmed as the needed command path for future chat/intake boundaries.
  - Body must be validated with a narrow shared schema and forwarded to the confirmed upstream send endpoint.
- `GET /api/observe/:wikiSpaceId/:observeKind`
  - Proxies only allowlisted observation streams for a space. Initial `observeKind` candidates are `entities` and `shared-state`, but implementation must confirm whether this maps cleanly to actual `createAgentsClient.observe(...)` usage.
  - The Worker maps `observeKind` and `wikiSpaceId` to one of the confirmed upstream stream paths, such as an entities membership stream or a specific shared-state id.
- `POST /api/observe/:wikiSpaceId/:observeKind/ensure`
  - Optional only if confirmed necessary for `client.observe(entities(...))` because runtime source showed `ensureEntitiesMembershipStream` uses `POST /_electric/observations/entities/ensure-stream`.

If discovery proves these names need adjustment for compatibility with `createAgentsClient` or `createStreamDB`, update the route names before implementation and keep the same invariants: safe names, Worker-resolved targets, no arbitrary upstream paths.

## Security invariants

- [ ] Browser never calls Electric Agents upstream directly.
- [ ] Browser never receives `ELECTRIC_CLOUD_API_TOKEN`, `ELECTRIC_AGENTS_TOKEN`, `ELECTRIC_AGENTS_PRINCIPAL_KEY`, upstream base URL secrets, write tokens, or source secrets.
- [ ] Worker injects token/server config only server-side.
- [ ] Browser cannot choose arbitrary upstream agent, entity URL, space id, shared-state id, observe target, stream path, runtime path, or collection/table.
- [ ] Only explicit allowlisted protocol/query params are forwarded.
- [ ] Client request headers are not blindly forwarded; only explicitly allowlisted headers are copied.
- [ ] Upstream response headers are copied through a sanitizer that deletes `content-encoding` and `content-length`.
- [ ] CORS exposes required protocol/observe headers only if browser stream code reads them.
- [ ] Tests prove tokens are not leaked in success or error responses.
- [ ] Tests prove malicious paths such as encoded `/_electric/entities/...`, `..`, slash-containing ids, unknown observe kinds, and extra query/body parameters are rejected or ignored.

## Task 1: Discovery — confirm Agents API and protocol details from real code

- [ ] Inspect `packages/agents-runtime/src/agents-client.ts`, `runtime-server-client.ts`, `observation-sources.ts`, `entity-stream-db.ts`, `types.ts`, and any server route definitions that handle the runtime paths.
- [ ] Inspect `@durable-streams/state` usage in this repo enough to identify stream query parameters and response headers required by `createStreamDB` / `createEntityStreamDB` in the browser.
- [ ] Inspect `examples/deep-survey/src/ui/hooks/useSwarm.ts` and `examples/deep-survey/src/server/index.ts` to identify actual client calls and upstream routes used by a working Agents example.
- [ ] Write a short implementation note in the eventual PR/summary identifying the confirmed upstream paths and required stream params/headers.
- [ ] Before implementing Tasks 2+, lock the confirmed public Worker route names, `EntityKind` values, `ObserveKind` values, upstream target paths, query-param allowlist, request-header allowlist, and response-header expose list. Treat this plan's candidate routes/kinds as placeholders until this discovery is complete.
- [ ] Before implementing Tasks 2+, define narrow adapter types from the confirmed APIs. Do not invent broad endpoint names or route semantics.

Suggested commands:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
grep -R "ensureEntitiesMembershipStream\|getSharedStateStreamPath\|entityRpcPath\|createEntityStreamDB\|createStreamDB" -n packages/agents-runtime packages/agents packages/agents-server examples/deep-survey | head -200
grep -R "content-encoding\|content-length\|electric-offset\|electric-handle\|streamOptions\|searchParams" -n packages/agents-runtime packages/typescript-client packages/*state* examples | head -200
```

Expected: implementer can list exact upstream paths, query params, and headers before writing proxy code.

## Task 2: Add shared schemas and target intent types

- [ ] Create `examples/living-wiki/src/shared/agents-proxy.ts` with Zod schemas/types for browser-safe intents, not upstream URLs:
  - `EntityKind` allowlist for phase-safe Living Wiki kinds, initially minimal such as `wiki-space`, `intake`, `source`, `wiki`, `topic-curator`, `review-board` if confirmed by docs; otherwise start with only `wiki-space` and document expansion in a later entity plan.
  - `ObserveKind` allowlist from discovery, likely `entities` and/or `shared-state`.
  - `AgentsEntityTargetInput` with `wikiSpaceId`, `entityKind`, and `entityId`, each URL-safe and slash-free.
  - `AgentsObserveTargetInput` with `wikiSpaceId` and `observeKind`.
  - Optional `AgentsSendMessageInput` only if non-streaming send is implemented in this phase.
- [ ] Create `examples/living-wiki/src/shared/agents-proxy.test.ts` covering valid ids, invalid slash/encoded path ids, unknown entity kinds, unknown observe kinds, and payload size/type restrictions.
- [ ] Run:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test src/shared/agents-proxy.test.ts
```

Expected: tests pass after implementation.

## Task 3: Add allowlist constants/helpers for query params and headers

- [ ] Create `examples/living-wiki/src/worker/agents-proxy/allowlists.ts`.
- [ ] Define `AGENTS_OBSERVE_PROTOCOL_QUERY_PARAMS` from discovery. Include only params that the actual stream client needs for cursor/resume/cache behavior. Do not forward `table`, `where`, arbitrary `params[...]`, arbitrary `source`, arbitrary `path`, or unknown keys.
- [ ] Define `AGENTS_REQUEST_HEADER_ALLOWLIST`, initially as small as possible. Do not forward browser `authorization`, cookies, `host`, `x-forwarded-*`, or arbitrary `electric-*` headers unless discovery proves one is required and safe.
- [ ] Define `AGENTS_RESPONSE_HEADER_EXPOSE_ALLOWLIST` from discovery. Include only stream/protocol headers the browser needs to read.
- [ ] Export helpers:
  - `copyAllowedObserveSearchParams(from: URLSearchParams, to: URLSearchParams): void`
  - `copyAllowedRequestHeaders(from: Headers): Headers`
  - `sanitizeProxiedResponseHeaders(headers: Headers, options?: { exposeCorsHeaders?: boolean }): Headers`
- [ ] `sanitizeProxiedResponseHeaders` must delete `content-encoding` and `content-length` unconditionally.
- [ ] Create `allowlists.test.ts` covering allowed params, rejected arbitrary params, rejected auth/cookie headers, response header stripping, and CORS expose behavior.
- [ ] Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/allowlists.test.ts
```

Expected: tests pass and prove proxy-auth invariants.

## Task 4: Add Worker env and upstream config helpers

- [ ] Modify `examples/living-wiki/src/worker/env.ts` to add typed optional bindings confirmed by discovery, for example:
  - `ELECTRIC_AGENTS_BASE_URL` or reuse existing `ELECTRIC_CLOUD_API_URL` only if that is the actual runtime base URL.
  - `ELECTRIC_AGENTS_TOKEN` or reuse `ELECTRIC_CLOUD_API_TOKEN` only if the same token is confirmed for Agents runtime calls.
  - `ELECTRIC_AGENTS_PRINCIPAL_KEY` only if the confirmed client/server path requires it.
- [ ] Do not expose these fields through `healthResponse` or other browser JSON. Health may expose booleans only.
- [ ] If reusing existing names, document the mapping in README and tests.
- [ ] Add or update tests in `proxy.test.ts`/`index.test.ts` proving token values do not appear in health or proxy error JSON.

Expected: typecheck passes and no browser-facing types import secret env values.

## Task 5: Implement target resolver with no arbitrary upstream path control

- [ ] Create `examples/living-wiki/src/worker/agents-proxy/targets.ts`.
- [ ] Implement target resolver functions that convert validated intents into upstream paths:
  - `resolveEntityMainStreamTarget(input, env)` returns a confirmed upstream stream path for the entity main stream.
  - `resolveEntitySendTarget(input, env)` only if send is in scope.
  - `resolveObserveTarget(input, env)` returns a confirmed upstream observe stream/ensure target.
- [ ] The resolver must derive Living Wiki entity URLs from allowlisted `entityKind` and slash-free ids; it must not accept a raw `entityUrl` or `streamPath` from the browser.
- [ ] For shared-state observation, derive the shared-state id from `wikiSpaceId` or from an existing server-side WikiSpace record once available. In this phase, use a deterministic server-side mapping and name it explicitly as a proxy-boundary placeholder.
- [ ] For entities membership observation, derive tags server-side, e.g. `wiki_space_id=<id>`, never from browser-supplied tag maps.
- [ ] Create `targets.test.ts` covering valid mappings, rejected unknown kinds, rejected malformed ids, encoded slash attempts, inability to override tags/shared-state id via query/body, and stable deterministic paths.
- [ ] Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/targets.test.ts
```

Expected: tests pass.

## Task 6: Implement core proxy adapter with fake upstream fetch tests

- [ ] Create `examples/living-wiki/src/worker/agents-proxy/proxy.ts`.
- [ ] Export a small adapter API, for example:
  - `proxyAgentsGet(request, env, target, options)`
  - `proxyAgentsPost(request, env, target, options)`
  - or a single `proxyAgentsRequest({ request, env, target, method, bodyPolicy, fetchImpl })`.
- [ ] Adapter responsibilities:
  - Build upstream URL from server env base URL plus resolved target path.
  - Copy only allowed observe protocol query params where applicable.
  - Copy only allowed request headers.
  - Inject server-side token/principal headers from env.
  - For JSON command bodies, forward only schema-validated normalized bodies from route code, not the raw client body.
  - For stream GETs, forward no body.
  - Use injected `fetchImpl` in tests for fake upstream assertions.
  - Sanitize upstream response headers by deleting `content-encoding` and `content-length`.
  - Preserve status/statusText/body for stream compatibility.
- [ ] Create `proxy.test.ts` with fake upstream fetch assertions:
  - upstream URL is exactly expected for entity stream.
  - browser `authorization`/cookie headers are not forwarded.
  - server token/principal is injected.
  - only allowlisted query params are forwarded.
  - raw `table`, `where`, `path`, `stream`, `secret`, and unknown query params are not forwarded.
  - response strips `content-encoding` and `content-length`.
  - token is not present in downstream response headers/body on upstream error.
- [ ] Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/proxy.test.ts
```

Expected: tests pass.

## Task 7: Add REST proxy route module and wire it into Worker routes

- [ ] Create `examples/living-wiki/src/worker/agents-proxy/routes.ts`.
- [ ] Implement handlers for the public Worker API shape selected after discovery.
- [ ] Parse route params with shared schemas from `src/shared/agents-proxy.ts`.
- [ ] Reject unknown methods with 405 JSON and unknown proxy routes with `undefined` so existing `routes.ts` 404 behavior remains consistent.
- [ ] For stream/observe proxy responses, return the proxied upstream `Response` directly after adapter sanitization.
- [ ] For validation errors, return concise JSON without secrets.
- [ ] Modify `examples/living-wiki/src/worker/routes.ts` to call `handleAgentsProxyRequest(request, env)` before generic `/api/*` 404.
- [ ] Create `routes.test.ts` and/or extend `index.test.ts` covering:
  - valid entity stream route calls fake upstream.
  - valid observe route calls fake upstream or adapter with expected target.
  - invalid ids/kinds are 400/404 without upstream fetch.
  - unknown proxy routes are not proxied to upstream.
  - malicious query params are ignored.
  - token is absent from all browser-visible responses.
- [ ] Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/routes.test.ts src/worker/index.test.ts
```

Expected: tests pass.

## Task 8: Add tRPC command procedures only for non-streaming calls if appropriate

- [ ] If discovery confirms a narrow non-streaming command path is needed now, modify `examples/living-wiki/src/worker/trpc-router.ts` to add procedures such as `agent.sendMessage` using existing tRPC/Zod patterns.
- [ ] Do not use tRPC for streaming observe endpoints in this phase unless repo APIs explicitly support it.
- [ ] Procedure input must use shared schemas and target resolvers; it must not accept raw upstream URLs.
- [ ] Tests must prove token non-leakage and target allowlisting.
- [ ] If no non-streaming command is necessary for this boundary phase, do not implement it. Record the explicit decision in the implementation summary, including why streaming/proxy routes are sufficient for this phase and where command support belongs in the later entity orchestration phase.

Expected: existing tRPC health/space tests remain green.

## Task 9: Add browser client wrappers for proxy APIs

- [ ] Create `examples/living-wiki/src/app/api/agentsProxyApi.ts`.
- [ ] Export small functions that construct Worker-local URLs only:
  - `getEntityStreamUrl(input): string`
  - `getObserveUrl(input, protocolParams?: URLSearchParams | Record<string, string>): string`
  - Optional `sendAgentMessage(input): Promise<...>` if Task 8/REST send is implemented.
- [ ] These helpers must not import `src/worker/env.ts` or include upstream base URLs/tokens.
- [ ] If using `createAgentsClient`, wrap it so `baseUrl` points to the Living Wiki Worker origin and target selection still goes through safe proxy route helpers. Do not configure it with upstream Electric Agents URLs in browser code.
- [ ] Create `agentsProxyApi.test.ts` covering URL construction, encoded route params, rejection of raw upstream paths, and no token/base URL usage.
- [ ] Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/app/api/agentsProxyApi.test.ts
```

Expected: tests pass.

## Task 10: README documentation update

- [ ] Update `examples/living-wiki/README.md` with:
  - new env vars/secrets and whether they are Worker-only;
  - public proxy route names and what they are allowed to observe/send;
  - explicit statement that browser code must use `/api/agents/...` and `/api/observe/...`, never the Electric Agents upstream base URL;
  - security invariants from this plan;
  - test commands for the proxy boundary.
- [ ] Do not document speculative Electric Cloud endpoints. Use only endpoints confirmed in Task 1 or the safe Worker route names implemented in this phase.

## Task 11: Full verification

- [ ] Run unit tests for the phase:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test src/shared/agents-proxy.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/allowlists.test.ts src/worker/agents-proxy/targets.test.ts src/worker/agents-proxy/proxy.test.ts src/worker/agents-proxy/routes.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/app/api/agentsProxyApi.test.ts
```

- [ ] Run full example checks:

```bash
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

- [ ] Optional local smoke test with fake or configured upstream:

```bash
pnpm --filter @electric-ax/example-living-wiki dev
```

Then verify in browser devtools or with curl that Living Wiki pages call only Worker `/api/agents/...` or `/api/observe/...` URLs and that no token appears in responses.

## Task 12: Security self-review before commit

- [ ] Search browser/app files for upstream env names and confirm none are imported or embedded.
- [ ] Search Worker proxy code for broad param/header/path forwarding and replace with allowlist helpers.
- [ ] Confirm every upstream target is produced by `targets.ts`, not read from client URL/body/query.
- [ ] Confirm `content-encoding` and `content-length` are stripped in one shared helper covered by tests.
- [ ] Confirm CORS exposed headers are minimal and justified by discovery.
- [ ] Confirm fake upstream tests include a secret token string and fail if it appears downstream.
- [ ] Confirm no full Living Wiki entity orchestration, graph generation, or source digestion was added.
- [ ] Run a final implementation security scan across `examples/living-wiki/src/app`, `examples/living-wiki/src/shared`, and `examples/living-wiki/src/worker/agents-proxy` for upstream env names, raw `/_electric` browser URLs, broad forwarding loops, `content-encoding`/`content-length` sanitizer coverage, and token strings in downstream test responses.
- [ ] Run a final wording scan for postponed-work marker terms without embedding them literally in the shell command:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
python3 - <<'SCAN'
from pathlib import Path
terms = ['T'+'BD', 'TO'+'DO', 'implement'+' later', 'fill in'+' details']
paths = [Path('docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy.md')]
found = False
for path in paths:
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        if any(term.lower() in line.lower() for term in terms):
            print(f'{path}:{line_no}:{line}')
            found = True
raise SystemExit(1 if found else 0)
SCAN
```

Expected: no output and exit code 0.

## Acceptance criteria

- Worker exposes secure Living Wiki proxy routes for confirmed Electric Agents observe/entity stream needs.
- Browser helpers build only Worker-local proxy URLs and cannot select arbitrary upstream paths.
- Worker injects upstream auth/principal/server config only server-side.
- Allowlist helpers control all forwarded params/headers.
- Response sanitizer strips `content-encoding` and `content-length`.
- Tests with fake upstream prove URL/header/body behavior and token non-leakage.
- Existing create/join/get API boundary tests still pass.
- README documents the boundary and security rules.
- No full Living Wiki entity orchestration or graph generation is implemented in this phase.
