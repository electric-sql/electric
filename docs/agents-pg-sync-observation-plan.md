# Prototype Plan: Observe Postgres sync streams from Agents

## Prototype goal

Build a working prototype of Agents observing Electric Postgres shape streams.

Prototype API:

```ts
await ctx.observe(
  pgSync({
    table: 'todos',
    replica: 'full',
  }),
  { wake: { on: 'change', ops: ['insert'] } }
)
```

Horton demo tool:

```ts
observe_pg_sync({
  table: 'todos',
  where: "priority = 'high'",
  replica: 'full',
  wake: { ops: ['delete'] },
})
```

Prototype simplifications:

- No URL argument. The server assumes Electric is at `http://localhost:3000/v1/shape`.
- No enablement env flags.
- No URL/table allowlists yet.
- No auth/secret injection yet.
- Keep `pgSync` narrower than raw `ShapeStreamOptions`.
- Accept only JSON-safe source config: `table`, `columns`, `where`, `params`, `replica`.
- Exclude ShapeStream runtime/transport options: `liveSse`, `subscribe`, `fetchClient`, `signal`, `onError`, `headers`, `parser`, `transformer`, `columnMapper`, `log`, `offset`, `handle`.

The server will own the `ShapeStream`, append its updates to a durable stream, and wake observing agents through the existing wake registry.

Reviewer-driven constraints:

- This is a new bridge subsystem modeled after `EntityBridgeManager`, not an extension of the existing `entities()` bridge. The current `entities()` bridge is hard-coded to the Agents `entities` table and tag membership stream.
- Do not rely on `EntityBridgeManager.onEntityChanged()`; it is intentionally a no-op. Shape tailing is the source of truth.
- Make wake delivery explicit. If pgSync bridge appends bypass the agents-server stream append route, the bridge must explicitly invoke the same wake evaluation path after appending.
- Keep manual Electric/Postgres smoke tests optional until unit/integration seams are in place.
- Use shared canonicalization helpers for runtime and server so `sourceRef` cannot diverge.

## Existing implementation to copy

Use `observe(entities())` as the template. It already does almost exactly what this prototype needs, but for the constrained built-in `entities` table.

Key files:

- Runtime source helper: `packages/agents-runtime/src/observation-sources.ts`
- Runtime registration before preload: `packages/agents-runtime/src/process-wake.ts`
- Out-of-handler client registration: `packages/agents-runtime/src/agents-client.ts`
- Runtime server client: `packages/agents-runtime/src/runtime-server-client.ts`
- Server registration route: `packages/agents-server/src/routing/entities-router.ts`
- Entity bridge manager: `packages/agents-server/src/entity-bridge-manager.ts`
- Manifest/wake mapping: `packages/agents-server/src/manifest-side-effects.ts`
- Manifest source reference tracking: `packages/agents-server/src/entity-manager.ts` and `packages/agents-server/src/runtime.ts`

`EntityBridgeManager` pattern to copy:

1. Persist a source registration row with `sourceRef`, config, stream URL, and ShapeStream cursor.
2. Ensure the durable stream exists.
3. Start a server-owned `ShapeStream`.
4. Bootstrap from `offset: '-1'` to reconcile current state.
5. Append normalized Durable Streams events with `type` and `headers.operation`.
6. Persist `shapeHandle` / `lastOffset` for efficient restart.
7. Handle `must-refetch` by clearing cursor and resyncing.
8. Keep bridges alive while referenced by manifests/readers; garbage collect idle bridges.

For the prototype, `PgSyncBridgeManager` should be a generalized `EntityBridgeManager` with source config `{ table, columns, where, params, replica }` and stream path `/_electric/pg-sync/<sourceRef>`.

## Durable stream shape

Use stream path:

```txt
/_electric/pg-sync/<sourceRef>
```

`sourceRef` is deterministic from canonicalized config:

```json
{
  "table": "todos",
  "where": "priority = 'high'",
  "params": [],
  "columns": ["id", "text"],
  "replica": "full"
}
```

Initial event collection:

```ts
export const pgSyncObservationCollections = {
  changes: {
    type: 'pg_sync_change',
    primaryKey: 'key',
  },
}
```

Append events like:

```ts
{
  type: 'pg_sync_change',
  key: '<stable message key>',
  value: {
    key: '<stable message key>',
    table: 'todos',
    operation: 'insert' | 'update' | 'delete',
    rowKey?: string,
    value?: unknown,
    oldValue?: unknown,
    headers: Record<string, unknown>,
    offset?: string,
    receivedAt: string,
  },
  headers: {
    operation: 'insert' | 'update' | 'delete',
    timestamp: string,
  },
}
```

This lets the existing wake condition matcher handle:

```ts
{ on: 'change', ops: ['insert'] }
```

without new wake semantics.

## Implementation slices

Each slice should leave the repo in a working, testable state before moving on.

---

## Slice 1 — Add the runtime `pgSync` source helper only

### Goal

Agents can construct a `pgSync(...)` observation source with a deterministic `sourceRef`, `streamUrl`, schema, wake default, and manifest entry. No server registration or ShapeStream work yet.

### Changes

In `packages/agents-runtime/src/observation-sources.ts`:

- Add `PgSyncOptions`:

```ts
export interface PgSyncOptions {
  table: string
  columns?: string[]
  where?: string
  params?: string[] | Record<string, string>
  replica?: 'default' | 'full'
}
```

- Add `getPgSyncStreamPath(sourceRef)`.
- Add canonicalization and hashing for `sourceRef`.
- Add `pgSyncObservationCollections`.
- Add `PgSyncObservationSource` with `sourceType: 'pgSync'`.
- Add `pgSync(options)`.
- Add default `wake()` returning:

```ts
{
  sourceUrl: getPgSyncStreamPath(sourceRef),
  condition: { on: 'change', collections: ['pg_sync_change'] },
}
```

- Export `pgSync` from:
  - `packages/agents-runtime/src/index.ts`
  - `packages/agents-runtime/src/client.ts`

### Tests

Add runtime unit tests, e.g. `packages/agents-runtime/test/pg-sync-source.test.ts`:

- `pgSync({ table: 'todos' })` returns `sourceType: 'pgSync'`.
- Equivalent configs produce the same `sourceRef`.
- Different table/where/params produce different `sourceRef`s.
- `streamUrl` is `/_electric/pg-sync/<sourceRef>`.
- `toManifestEntry()` serializes only JSON-safe config.
- `wake()` points at the pg-sync stream and `pg_sync_change` collection.
- `params` object key order does not affect `sourceRef`.
- Undefined optional fields are omitted consistently.
- Decide and test whether `columns` order is meaningful. For the prototype, prefer preserving order because Electric column projection order may be meaningful.
- `replica` defaulting is deterministic: decide whether `pgSync({ table })` and `pgSync({ table, replica: 'default' })` are identical, then lock that behavior in tests.

### Verification command

```sh
cd packages/agents-runtime
pnpm test -- test/pg-sync-source.test.ts
```

Do not continue until these tests pass.

---

## Slice 2 — Teach manifest/wake code about `pgSync`

### Goal

A `pgSync` manifest source can become a wake registration pointing at the pg-sync durable stream. Still no server ShapeStream bridge yet.

### Changes

In `packages/agents-server/src/manifest-side-effects.ts`:

- Extend `extractManifestSourceUrl()`:

```ts
if (manifest.sourceType === 'pgSync') {
  return typeof manifest.sourceRef === 'string'
    ? `/_electric/pg-sync/${manifest.sourceRef}`
    : undefined
}
```

No custom wake semantics needed; `buildManifestWakeRegistration()` should work once `extractManifestSourceUrl()` works.

### Tests

Add/extend server tests for manifest side effects:

- Given a `pgSync` source manifest with `sourceRef`, `extractManifestSourceUrl()` returns `/_electric/pg-sync/<sourceRef>`.
- Given a `pgSync` source manifest with `wake: { on: 'change', ops: ['delete'] }`, `buildManifestWakeRegistration()` returns a registration with:
  - `sourceUrl: '/_electric/pg-sync/<sourceRef>'`
  - `condition.ops: ['delete']`
  - `oneShot: false`
- Manifest without `sourceRef` returns no wake registration / safe `undefined` behavior.
- Object-form wake preserves `collections`, `ops`, `debounceMs`, and `timeoutMs`.
- If `extractManifestSourceUrl()` is not exported, test through `buildManifestWakeRegistration()` instead of exporting only for tests.

### Verification command

```sh
cd packages/agents-server
pnpm test -- test/manifest-side-effects.test.ts
```

Do not continue until these tests pass.

---

## Slice 3 — Add registration plumbing in three small steps

### Goal

Runtime can tell the server “ensure this pgSync source exists” and receive `{ sourceRef, streamUrl }`. This slice is intentionally split so each part is testable without a live `ShapeStream`.

### Slice 3a — Runtime server client method

In `packages/agents-runtime/src/runtime-server-client.ts`:

- Add `registerPgSyncSource(options)` to the interface and implementation.
- POST to `/_electric/pg-sync/register`.
- Send only `options`; the server computes `sourceRef` using the shared canonicalization helper and returns `{ sourceRef, streamUrl }`.
- Test non-2xx error handling.

Tests:

- Add `packages/agents-runtime/test/runtime-server-client-pg-sync.test.ts`.
- Mock fetch and assert:
  - URL path is `/_electric/pg-sync/register`.
  - method is `POST`.
  - JSON body is `{ options }`.
  - response parsing returns `sourceRef`/`streamUrl`.
  - non-OK response throws useful error text.

Verification:

```sh
cd packages/agents-runtime
pnpm test -- test/runtime-server-client-pg-sync.test.ts
```

### Slice 3b — Server registration route stub

In `packages/agents-server`:

- Add a route module or extend an existing internal/electric router with:

```txt
POST /_electric/pg-sync/register
```

Request body:

```ts
{
  options: PgSyncOptions
}
```

Response:

```ts
{
  sourceRef: string,
  streamUrl: '/_electric/pg-sync/<sourceRef>'
}
```

For this step, route behavior is minimal:

- Validate `table` is a non-empty string.
- Compute `sourceRef` from shared canonicalization.
- Ensure durable stream exists using the existing `StreamClient` path.
- Return stream metadata.
- Do not start `ShapeStream` yet.

Tests:

- Add `packages/agents-server/test/pg-sync-router.test.ts`.
- Registering `{ table: 'todos' }` returns expected stream path.
- Invalid table returns 400.
- Server-computed `sourceRef` matches runtime helper output. Prefer importing one shared helper rather than duplicating hashing logic.

Verification:

```sh
cd packages/agents-server
pnpm test -- test/pg-sync-router.test.ts
```

### Slice 3c — Runtime observe wiring

In both places that already special-case `entities`:

- `packages/agents-runtime/src/process-wake.ts`
- `packages/agents-runtime/src/agents-client.ts`

Add:

```ts
if (source.sourceType === 'pgSync') {
  await serverClient.registerPgSyncSource(source.options)
}
```

This must happen before `setupCtx.observe(...)` / client preload opens the source StreamDB.

Tests:

- Add or extend tests that mirror existing cron/entities registration behavior.
- Assert observing a `pgSync` source calls `registerPgSyncSource` before source DB preload.
- Assert out-of-handler `agentsClient.observe(pgSync(...))` also registers first.

Verification:

```sh
cd packages/agents-runtime
pnpm test -- pg-sync
```

Do not continue until all Slice 3a/3b/3c tests pass.

---

## Slice 4 — Implement a minimal `PgSyncBridgeManager` that appends ShapeStream messages

### Goal

Registering a pgSync source starts a server-owned `ShapeStream` against `http://localhost:3000/v1/shape` and appends received change messages to `/_electric/pg-sync/<sourceRef>`.

This slice proves durable stream mirroring works. Wake delivery can be verified in the next slice.

### Changes

Add `packages/agents-server/src/pg-sync-bridge-manager.ts` modeled after `entity-bridge-manager.ts`.

For the prototype:

- Use Electric URL constant: `http://localhost:3000/v1/shape`.
- Start with simple lifecycle:
  - `register(options)` ensures stream exists and starts bridge.
  - Maintain in-memory map of active bridges.
  - Persist source rows/cursors only if easy to reuse existing registry patterns; otherwise add persistence in Slice 6.
- Use `ShapeStream` directly.
- Use `params`:

```ts
{
  table,
  columns,
  where,
  params,
  replica,
}
```

- Append only `isChangeMessage(message)` initially.
- For `isControlMessage(message)`:
  - ignore `up-to-date` for now,
  - on `must-refetch`, restart from `offset: '-1'`.

Event append mapping:

- Durable event `type`: `pg_sync_change`
- Durable event `key`: use Electric message offset when available, else `${message.headers.operation}:${message.key}` or UUID fallback.
- Durable event `headers.operation`: Electric message operation.
- Durable event `value`: include table, operation, Electric headers, row value/old value, received timestamp.

Wire the route from Slice 3 to call `pgSyncBridgeManager.register(...)`.

### Tests

Unit-test seams before any live Electric smoke test:

- `buildElectricShapeParams(options)`:
  - maps `table`, `columns`, `where`, `params`, `replica` into `ShapeStream` `params`.
  - never forwards excluded options such as `liveSse`, `headers`, `fetchClient`, `offset`, or `handle` from source config.
- `pgSyncMessageToDurableEvent(message, options/sourceRef)`:
  - insert maps to `headers.operation: 'insert'`.
  - update maps to `update`.
  - delete maps to `delete` and preserves old value/value as available.
  - event key is stable from offset/key.
- Bridge lifecycle with mocked `ShapeStream`:
  - register starts one stream per `sourceRef`.
  - second register of same source does not start a duplicate bridge.
  - change message appends expected durable event.
  - `must-refetch` restarts from `offset: '-1'`.

### Optional manual smoke verification

Only run this after unit tests pass. Run local Electric stack and agents server, then:

1. Register a pgSync source via HTTP.
2. Insert a row in Postgres.
3. Read `/_electric/pg-sync/<sourceRef>` from Durable Streams.
4. Confirm a `pg_sync_change` event appears.

Example verification shape:

```sh
curl -X POST http://localhost:4437/_electric/pg-sync/register \
  -H 'content-type: application/json' \
  -d '{"options":{"table":"todos","replica":"full"}}'
```

Then mutate Postgres and read the returned stream URL.

Do not continue until the durable stream receives events. If repo dev scripts configure Electric on a different local port, keep the prototype code aligned with the user-requested default `http://localhost:3000/v1/shape` or update the smoke-test environment to expose that port.

---

## Slice 5 — Connect pgSync durable events to wake delivery

### Goal

An agent observing `pgSync(...)` wakes when matching durable stream events are appended.

### Changes

Depending on how append/wake evaluation is structured:

- Ensure pgSync bridge appends through the same stream append path that triggers `EntityManager` wake evaluation, or explicitly call the same wake evaluation method used for entity/shared-state stream appends.
- Confirm source URL passed to wake registry is exactly `/_electric/pg-sync/<sourceRef>`.
- Confirm durable event shape has:
  - `type: 'pg_sync_change'`
  - `headers.operation: 'insert' | 'update' | 'delete'`

The existing `WakeRegistry.matchCondition()` should then match:

```ts
{ on: 'change', ops: ['insert'] }
```

### Tests

Add a wake-registry/entity-manager integration test if feasible:

- Register wake:
  - `subscriberUrl: '/horton/a'`
  - `sourceUrl: '/_electric/pg-sync/test'`
  - `condition: { on: 'change', ops: ['insert'] }`
- Evaluate/append insert event.
- Assert wake result is produced.
- Evaluate/append delete event.
- Assert no wake for insert-only registration.

Also test two registrations on same source:

- Agent A wakes on `insert`.
- Agent B wakes on `delete`.
- Insert wakes A only.
- Delete wakes B only.
- Collection filtering works with `collections: ['pg_sync_change']`.

Add one test proving the bridge append path invokes the same wake evaluation path used by existing stream appends, not just that `WakeRegistry.matchCondition()` works in isolation.

### Manual verification

Run two Horton instances:

1. Horton A: call `observe_pg_sync({ table: 'todos', replica: 'full', wake: { ops: ['insert'] } })`.
2. Horton B: call `observe_pg_sync({ table: 'todos', where: "priority = 'high'", replica: 'full', wake: { ops: ['delete'] } })`.
3. Insert into `todos`.
4. Confirm Horton A wakes.
5. Delete a matching high-priority todo.
6. Confirm Horton B wakes.

Do not continue until this end-to-end demo works.

---

## Slice 6 — Add persistence/resume and `must-refetch` robustness

### Goal

Make the prototype resilient enough for server restart and shape reset, following `EntityBridgeManager` more closely.

### Changes

Add persistence for pgSync bridge registrations and cursors. Options:

- Add a `pg_sync_bridges` table similar to existing entity bridge metadata, or
- Reuse a generic bridge/source table if one exists.

Persist:

- `sourceRef`
- canonical options JSON
- `streamUrl`
- `shapeHandle`
- `shapeOffset`
- `lastTouchedAt`

On server start:

- Load existing pgSync bridge rows.
- Restart active/referenced bridges.
- Resume with stored `shapeHandle` + `shapeOffset` if valid.
- Otherwise bootstrap from `offset: '-1'`.

On `must-refetch`:

- Clear cursor.
- Resync from `offset: '-1'`.

Optional for prototype but useful:

- Idle GC modeled after `EntityBridgeManager`.
- Touch bridge when its durable stream is read or registered.

### Tests

- Register source persists row.
- Cursor is updated after messages.
- Manager startup resumes from stored cursor.
- Duplicate/idempotency behavior on resume is controlled.
- Stale/invalid stored shape handle falls back to bootstrap.
- `must-refetch` clears cursor and restarts bootstrap.
- Only test `lastTouchedAt`/GC if GC is implemented in this slice; otherwise leave GC out of scope.

### Verification

Manual restart test:

1. Register source.
2. Mutate Postgres; confirm event appended.
3. Restart agents server.
4. Mutate Postgres again.
5. Confirm new event appended without duplicating the entire stream unexpectedly.

---

## Slice 7 — Add Horton `observe_pg_sync` tool

### Goal

Horton can set up pgSync observations from chat for the demo.

### Changes

Add `packages/agents/src/tools/observe-pg-sync.ts` or define in Horton tools.

Tool args:

```ts
{
  table: string,
  columns?: string[],
  where?: string,
  params?: string[] | Record<string, string>,
  replica?: 'default' | 'full',
  wake?: {
    ops?: Array<'insert' | 'update' | 'delete'>,
    debounceMs?: number,
    timeoutMs?: number
  }
}
```

Implementation:

```ts
const source = pgSync({ table, columns, where, params, replica })
await ctx.observe(source, {
  wake: {
    on: 'change',
    ...(wake?.ops ? { ops: wake.ops } : {}),
    ...(wake?.debounceMs ? { debounceMs: wake.debounceMs } : {}),
    ...(wake?.timeoutMs ? { timeoutMs: wake.timeoutMs } : {}),
  },
})
return { sourceRef: source.sourceRef, streamUrl: source.streamUrl, wake }
```

Add the tool to `createHortonTools(...)` in `packages/agents/src/agents/horton.ts`.

Update Horton system prompt tool list to include `observe_pg_sync`.

### Tests

- Place tests under `packages/agents/test`.
- Tool validates required `table`.
- Tool calls `ctx.observe(pgSync(...), { wake })`.
- Tool returns `sourceRef` and `streamUrl`.
- `observe_pg_sync` is included in Horton's tool list.
- Wake defaulting works when `wake.ops` is omitted.
- Invalid `ops` values are rejected by the tool schema.

### Manual verification

Use the exact demo flow:

- Horton A observes inserts.
- Horton B observes conditional deletes.
- Mutate Postgres and confirm each wakes only on its matching operation.

---

## Out of scope for this prototype

Defer these to a production hardening pass:

- URL selection / multiple Electric servers.
- URL allowlists and table allowlists.
- Auth/secret injection.
- Per-tenant authorization and shape authorization.
- UI for inspecting pgSync bridges.
- Rich filtering beyond Electric shape `where` plus wake `ops`.
- Typed row schemas for pgSync streams.
- Backpressure/batching optimizations.
- Full control-message event recording.

## Success criteria

The prototype is successful when:

1. `pgSync(...)` sources serialize to manifests.
2. The server registers and starts a ShapeStream for local Electric.
3. Shape changes are mirrored into a durable stream.
4. Existing wake conditions fire from those durable events.
5. Horton can call `observe_pg_sync` from chat.
6. Two Horton instances can observe different operations on the same or different pgSync sources.
