# Living Wiki bootstrap producer/read-path discovery

Date: 2026-06-03

Scope: Task 0 discovery for `docs/superpowers/plans/2026-06-03-living-wiki-bootstrap-and-source-intake.md`. The goal is to choose the smallest safe Worker-local shared-state producer/read path for Tasks 3-6 without guessing Agents runtime or Durable Streams write APIs.

## Sources and skills read

Plan/discovery notes read:

- `docs/superpowers/plans/2026-06-03-living-wiki-bootstrap-and-source-intake.md`
- `docs/superpowers/plans/2026-06-03-living-wiki-entity-discovery.md`
- `docs/superpowers/plans/2026-06-03-living-wiki-live-ui-discovery.md`

Repository source read:

- `examples/living-wiki/src/worker/routes.ts`
- `examples/living-wiki/src/worker/index.ts`
- `examples/living-wiki/src/worker/agents-proxy/routes.ts`
- `examples/living-wiki/src/worker/agents-proxy/proxy.ts`
- `examples/living-wiki/src/worker/agents-proxy/targets.ts`
- `examples/living-wiki/src/worker/wiki-space-store.ts`
- `examples/living-wiki/src/app/db/wikiStateDb.ts`
- `examples/living-wiki/src/app/hooks/useLivingWikiStateViewModels.ts`
- `examples/living-wiki/src/app/api/agentsProxyApi.ts`
- `examples/living-wiki/src/shared/wiki-state.ts`
- `node_modules/.pnpm/@durable-streams+state@0.2.9_typescript@5.8.3/node_modules/@durable-streams/state/dist/index.d.ts`
- `node_modules/.pnpm/@durable-streams+state@0.2.9_typescript@5.8.3/node_modules/@durable-streams/state/dist/index.js`
- `node_modules/.pnpm/@durable-streams+client@0.2.6/node_modules/@durable-streams/client/dist/index.d.ts`

Relevant previously loaded SKILL content from the committed live UI discovery was used for TanStack React DB, Durable Streams `createStreamDB`, and Agents Runtime entity stream queries. I also inspected the installed `@durable-streams/state` and `@durable-streams/client` type/runtime files directly to avoid guessing protocol details.

## Findings

### 1. Existing observe route is currently only an Agents upstream proxy

`GET /api/observe/:wikiSpaceId/:observeKind` is handled before REST routes in `examples/living-wiki/src/worker/index.ts` by `handleAgentsProxyRequest()`.

For `observeKind: "shared-state"`, `examples/living-wiki/src/worker/agents-proxy/routes.ts` calls `resolveObserveTarget()` and then `proxyAgentsStreamRequest()`. `resolveSharedStateObserveTarget()` builds an upstream target with a deterministic internal shared-state id and stream path. `proxyAgentsStreamRequest()` requires configured Agents runtime upstream settings and forwards the request to that upstream stream.

There is no local/demo branch in the current route. Therefore existing `/api/observe/:wikiSpaceId/shared-state` cannot safely serve Worker-local fake rows today. It is currently an upstream proxy path.

### 2. `createStreamDB` consumes Durable Streams JSON batches of state events, not arbitrary snapshots

The installed `@durable-streams/state` API confirms this event shape:

```ts
type Operation = 'insert' | 'update' | 'delete' | 'upsert'

type ChangeEvent<T = unknown> = {
  type: string
  key: string
  value?: T
  old_value?: T
  headers: {
    operation: Operation
    txid?: string
    timestamp?: string
    from?: string
    offset?: string
  }
}

type ControlEvent = {
  headers: {
    control: 'snapshot-start' | 'snapshot-end' | 'reset'
    offset?: string
  }
}
```

`createStreamDB` calls `stream.stream({ live, json: true, signal })`, subscribes with `subscribeJson`, and processes `batch.items`. Change items are applied to TanStack DB collections by `event.type`, `event.key`, `event.value`, and `event.headers.operation`. Control items support `reset`, `snapshot-start`, and `snapshot-end`.

The Durable Streams client JSON batch metadata includes `offset`, `upToDate`, optional `cursor`, and `streamClosed`. That metadata is produced by the Durable Streams client while reading the HTTP stream. Implementing a compatible HTTP read endpoint means matching the Durable Streams read/follow protocol closely enough for `DurableStream.stream({ json: true })`, including request query parameters, response framing/content type, stream offset headers, up-to-date semantics, and live behavior. Those details are not fully established by current Living Wiki source.

Conclusion: it is not safe in Tasks 3-6 to improvise a fake `/api/observe/:wikiSpaceId/shared-state` Durable Streams endpoint unless implementation reuses a real Durable Streams server adapter or performs separate protocol discovery. Returning a plain JSON object from the observe route would not satisfy `createStreamDB`.

### 3. Smallest safe read path: temporary REST snapshot endpoint plus a separate demo hook/API path

Recommendation for Tasks 3-6: do not adapt `/api/observe/:wikiSpaceId/shared-state` yet. Keep that route as the real upstream proxy boundary. Add a temporary Worker-local REST snapshot endpoint:

```http
GET /api/spaces/:wikiSpaceId/shared-state-snapshot
```

Response body should be a plain JSON object containing arrays keyed by existing collection names:

```ts
type WikiStateSnapshotResponse = {
  wiki_spaces: WikiSpaceRow[]
  actors: ActorRow[]
  memberships: MembershipRow[]
  activity_events: ActivityEventRow[]
  sources: SourceRow[]
  wiki_pages: WikiPageRow[]
  wiki_links: WikiLinkRow[]
  review_items: ReviewItemRow[]
  agent_runs: AgentRunRow[]
}
```

This endpoint should validate `wikiSpaceId`, require the local demo space to exist, and return only row arrays. It must never return stream offsets, upstream URLs, tokens, or raw shared-state ids.

App-side Task 6 should add a clearly named snapshot fetch path rather than changing `createLivingWikiStateDb`: add a snapshot API helper and a hook such as `useLivingWikiStateSnapshotViewModels({ wikiSpaceId, fetchImpl? })` that fetches the snapshot, feeds existing pure selectors, and optionally refetches after source submission. Keep `createLivingWikiStateDb()` and `useLivingWikiStateViewModels()` intact for the real observe path.

## Exact recommendation for Tasks 3-6

### Task 3: Worker-local producer adapter

Add `examples/living-wiki/src/worker/wiki-state-producer.ts` with a `WikiStateProducer` interface containing `bootstrapSpace(snapshot)`, `recordJoin(snapshot, actorId)`, `submitSource(command)`, and `getSnapshot(wikiSpaceId)`.

Implementation details:

- Back it with module-local in-memory maps keyed by `wikiSpaceId` and collection name.
- Store rows, not raw Durable Streams events, for the snapshot path.
- Use pure shared row builders from Tasks 1 and 2.
- Make row writes idempotent: upsert entity rows by id and avoid duplicate `activity_events` by deterministic event id.
- Do not call `ctx.mkdb`, `ctx.observe`, collection `.insert(...)`, upstream proxy code, or browser code.
- Export `getWikiStateProducer(_env: WorkerEnv)` and `resetLocalWorkerWikiStateProducerForTests()`.

Test reset should be called alongside `resetLocalDemoWikiSpaceStoreForTests()` in route/store tests.

### Task 4: create/join flow wiring

Keep REST response contracts for create, join, and get unchanged. Safest wiring point is route handlers after successful store mutation:

```ts
const snapshot = await getWikiSpaceStore(env).createSpace(input)
await getWikiStateProducer(env).bootstrapSpace(snapshot)
return json(snapshot)
```

For join, detect whether the actor already existed before mutation. Existing-actor refreshes should update/upsert rows without emitting a duplicate join event. New actors should call `recordJoin(snapshot, snapshot.currentActor.id)`. Do not make `getSpace` emit events.

### Task 5: source submission Worker API

Add REST endpoint:

```http
POST /api/spaces/:wikiSpaceId/sources
```

Suggested request body: `actorId`, `kind: "text" | "url"`, `title`, plus `body` for text or `url` for URL. Validate with Zod, reject route/body `wikiSpaceId` mismatches if body includes the id, verify the local demo space and actor with `getSpace({ wikiSpaceId, actorId })`, then call the producer.

Return only:

```ts
type SubmitSourceResponse = {
  source: SourceRow
  activityEventId: string
}
```

Do not return shared-state ids, stream paths, upstream metadata, offsets, auth headers, or token-derived values. REST-only is sufficient for this phase.

### Task 6: dashboard read path

Add `GET /api/spaces/:wikiSpaceId/shared-state-snapshot` in `routes.ts` before the generic `GET /api/spaces/:wikiSpaceId` match. The handler should validate route params, ensure the space exists, and return `getWikiStateProducer(env).getSnapshot(wikiSpaceId)`.

Add app files with names that make the temporary nature clear, for example:

```text
examples/living-wiki/src/app/api/wikiStateSnapshotApi.ts
examples/living-wiki/src/app/hooks/useLivingWikiStateSnapshotViewModels.ts
```

The hook should fetch the snapshot endpoint, pass row arrays to existing selectors, and expose `{ viewModel, isLoading, isError, refresh }`. Source submission UI can call `refresh()` after a successful source POST.

Do not alter `createLivingWikiStateDb()` to point at the snapshot endpoint, because it expects a Durable Streams stream. Do not return snapshot data from `/api/observe/:wikiSpaceId/shared-state` unless protocol compatibility with `createStreamDB` is proven first.

## Tests to add

Worker producer tests:

- create/bootstrap produces one `wiki_spaces` row, one owner actor, one owner membership, and one `space_created` activity event;
- join produces/updates actor and membership rows and one `space_joined` event;
- repeated existing-actor join updates display fields without duplicate join event;
- `getSnapshot()` returns all collection arrays with empty arrays for unpopulated collections;
- reset helper clears all producer state.

Worker route tests:

- create/join still return existing snapshots and also produce snapshot rows;
- `GET /api/spaces/:wikiSpaceId` is read-only and does not append activity;
- snapshot endpoint returns rows for existing spaces and 404 for missing spaces;
- source endpoint succeeds for text and URL and rejects missing actor, missing space, invalid kind, invalid URL, invalid text/body, invalid JSON, and unsupported methods.

App/security tests:

- snapshot URL helper encodes `wikiSpaceId` and does not include raw shared-state ids;
- snapshot hook maps rows through existing selectors and handles loading/error states;
- route/dashboard can render non-empty producer rows from injected/fetched snapshot data;
- source submit UI refreshes the snapshot path after success;
- serialized responses from create, join, get space, source submit, and snapshot route do not contain the raw shared-state id prefix, upstream base URL, `_electric/shared-state`, `streamUrl`, `offset`, `cursor`, auth headers, or token names.

## Risks

- Worker-local in-memory state is not durable and may be split across Worker isolates. This is acceptable for the demo phase and must be documented.
- The snapshot hook is not live. Source submission UI should explicitly refresh after mutations.
- A future local observe implementation must either reuse a real Durable Streams server/adapter or fully verify `@durable-streams/client` protocol requirements. It should not be inferred from the `ChangeEvent` item shape alone.
- Keeping both real observe and demo snapshot paths can confuse ownership. File and function names should include `Snapshot` or `WorkerLocal` and docs should say this is the temporary demo fallback.

## Red-flag scan

Current source scan shows raw shared-state ids are confined to shared id helpers, server/entity tests, and Worker proxy target code. Browser `createLivingWikiStateDb` constructs only `/api/observe/:wikiSpaceId/shared-state` and existing tests assert serialized DB config does not contain the raw prefix.

For Tasks 3-6, run a red-flag scan after implementation that checks browser source, Worker responses, and new tests for accidental exposure of raw shared-state ids, `_electric/shared-state` paths, upstream runtime URLs, auth/token data, or stream metadata fields in REST responses.

## Decision

Proceed with a Worker-local producer adapter plus a temporary REST snapshot endpoint. Do not adapt `/api/observe/:wikiSpaceId/shared-state` during Tasks 3-6. The observe route is currently an Agents upstream proxy, and `createStreamDB` requires a Durable Streams JSON event stream protocol that should not be guessed. The snapshot endpoint is the smallest safe path that lets create/join/source flows produce real shared-state-shaped rows for the demo dashboard while preserving the browser security boundary and leaving the real observe path unchanged.
