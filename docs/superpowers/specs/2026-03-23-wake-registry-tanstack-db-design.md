# Wake Registry TanStack DB Design

## Context

The current child wake delivery fix compensates for stale or incomplete wake registry state by reloading `wake_registrations` from Postgres when `runFinished` evaluation misses the in-memory cache. That fixes one symptom, but the underlying architecture still has two flawed state paths:

1. Tests imperatively manage an in-memory cache.
2. Runtime manually syncs a Postgres table into that cache with `Shape` / `ShapeStream`.

The desired replacement is to use TanStack DB as the wake registry state engine.

## Goals

- Make TanStack DB collection state the only in-memory source of wake registration rows.
- Use an Electric-backed collection in runtime so Postgres changes sync through Electric.
- Use a local-only collection only in unit tests.
- Use optimistic actions for every wake registry mutation.
- Use `queryOnce` for one-shot evaluation reads.
- Use `createEffect` for wake timeout timer side effects.
- Remove manual Shape subscription/cache code and the reload-on-miss workaround.

## Non-goals

- No `wake_registrations` schema migration.
- No custom TanStack DB adapter.
- No pull-wake runner changes.
- No changes to persisted wake row payloads.
- No broad `EntityManager` refactor beyond async wake evaluation call sites.

## Architecture

`WakeRegistry` owns one TanStack DB collection and one effect handle:

```ts
private registrationsCollection: Collection<WakeRegistrationCollectionRow> | null
private registrationsEffect: { dispose(): Promise<void> } | null
```

It no longer owns an authoritative `registrationCache`, `Shape`, `ShapeStream`, shape unsubscribe callback, or shape recovery promise.

The existing runtime delivery state remains in `WakeRegistry` because it is not registration row state:

- debounce timers
- debounce buffers
- latest debounced run status
- timeout timers
- timeout-delivered tracking
- timeout/debounce callbacks

### Collection row shape

Use camelCase fields internally:

```ts
type WakeRegistrationCollectionRow = {
  id: number
  tenantId: string
  subscriberUrl: string
  sourceUrl: string
  condition: WakeRegistration['condition']
  debounceMs: number
  timeoutMs: number
  oneShot: boolean
  timeoutConsumed: boolean
  includeResponse: boolean
  manifestKey: string | null
  createdAt: Date
}
```

`id` is both the TanStack DB collection key and the Postgres `wake_registrations.id`. Persisted rows already have a unique serial id, so the collection should use it directly rather than inventing a separate deterministic key.

For newly registered rows, the action input must include an id before `onMutate` runs, because optimistic actions apply collection changes synchronously. Runtime can preallocate the id from the Postgres sequence and then insert with that explicit id in the action `mutationFn`. Local-only tests can allocate ids from an in-memory counter.

## Runtime collection

`startSync(electricUrl, electricSecret)` creates an Electric collection over `wake_registrations`:

```ts
createCollection(
  electricCollectionOptions({
    id: `wake-registrations:${tenantId ?? 'all'}`,
    getKey: (row) => row.id,
    schema,
    shapeOptions: {
      url: electricUrlWithPath(electricUrl, '/v1/shape').toString(),
      params: {
        table: 'wake_registrations',
        ...(tenantId
          ? { where: `tenant_id = ${sqlStringLiteral(tenantId)}` }
          : {}),
        columns: [
          'id',
          'tenant_id',
          'subscriber_url',
          'source_url',
          'condition',
          'debounce_ms',
          'timeout_ms',
          'one_shot',
          'timeout_consumed',
          'include_response',
          'manifest_key',
          'created_at',
        ],
        replica: 'full',
        ...(electricSecret ? { secret: electricSecret } : {}),
      },
      parser: {
        timestamptz: (value: string) => new Date(value),
      },
      columnMapper: snakeCamelMapper(),
    },
    onInsert,
    onUpdate,
    onDelete,
  })
)
```

Use Electric's built-in `snakeCamelMapper()` in `shapeOptions.columnMapper` to map snake_case Postgres columns to camelCase collection fields. `created_at` must still parse to `Date` on the sync path via the `timestamptz` parser.

Startup fails if the collection cannot preload. Running with an empty registry after failed sync would silently drop terminal wake events.

## Local-only collection

Runtime requires Electric. There is no no-Electric Postgres fallback and no replacement for the old `loadRegistrations()` rebuild path.

For unit tests only, create or replace a local-only collection:

```ts
createCollection(
  localOnlyCollectionOptions({
    id: `wake-registrations-local:${tenantId ?? 'all'}`,
    getKey: (row) => row.id,
    initialData: [],
  })
)
```

Unit tests should not need Postgres or Electric just to exercise registry logic. They can start with an empty local-only collection and create rows through the same optimistic actions used by runtime.

Integration tests that need real persistence or cross-process sync should use Postgres + Electric and `startSync(...)`, not a local collection seeded from Postgres. Server startup without an Electric URL should fail rather than silently rebuilding local state from Postgres.

## Mutation model

All `WakeRegistry` mutations use `createOptimisticAction`. Public registry methods do not call `collection.insert`, `collection.update`, or `collection.delete` directly.

Actions:

- `registerAction`
- `unregisterByManifestKeyAction`
- `unregisterBySubscriberAction`
- `unregisterBySourceAction`
- `unregisterBySubscriberAndSourceAction`
- `markTimeoutConsumedAction`
- `consumeMatchedRegistrationsAction` or equivalent one-shot cleanup action

Each action has two responsibilities:

1. `onMutate`: synchronously apply optimistic changes to the collection.
2. `mutationFn`: persist the intent to Postgres in runtime mode and return/await a txid. In local-only mode, this is a no-op or minimal test hook.

### Register

`register(reg)` resolves the tenant, normalizes defaults, invokes `registerAction`, and awaits `tx.isPersisted.promise`.

`registerAction.onMutate` inserts or upserts the normalized row into the collection.

`registerAction.mutationFn` performs the existing insert:

- insert into `wake_registrations`
- `ON CONFLICT DO NOTHING`
- insert with the preallocated id
- if conflicted, fetch the existing row and transaction id

The transaction id comes from the same Postgres transaction:

```sql
SELECT pg_current_xact_id()::xid::text AS txid
```

The Electric collection should hold optimistic state until that txid syncs back. Because the action preallocates the numeric id, `WakeEvalResult.registrationDbId` can use the collection key directly.

### Bulk unregister actions

Bulk unregister methods are domain intents, not repeated ad-hoc row deletes. Each uses one optimistic action:

- `unregisterByManifestKey(subscriberUrl, manifestKey, tenantId?)`
- `unregisterBySubscriber(subscriberUrl, tenantId?)`
- `unregisterBySource(sourceUrl, tenantId?)`
- `unregisterBySubscriberAndSource(subscriberUrl, sourceUrl, tenantId?)`

Each action’s `onMutate` deletes all currently matching collection rows synchronously.

Each action’s `mutationFn` runs one SQL/Drizzle delete statement for the same predicate and returns/awaits the resulting txid.

Public methods await `tx.isPersisted.promise` because callers expect unregister completion.

### Timeout consumed

When a wake timeout is delivered or a matching event clears a timeout, `markTimeoutConsumedAction` updates the row:

```ts
draft.timeoutConsumed = true
```

Its runtime `mutationFn` persists `timeout_consumed = true` and returns/awaits a txid.

Current fire-and-forget semantics can stay fire-and-forget, but failures must be logged with tenant id, registration id, source url, and subscriber url.

### One-shot cleanup

When `evaluate()` matches one-shot registrations, it invokes a cleanup action that deletes the matched rows optimistically before `evaluate()` returns. This prevents immediate repeated evaluation from double-delivering.

Persistence can remain fire-and-forget if the current path is fire-and-forget, with logged failures.

## Evaluation reads

`evaluate()` becomes async:

```ts
async evaluate(
  sourceUrl: string,
  event: Record<string, unknown>,
  tenantId?: string
): Promise<Array<WakeEvalResult>>
```

It reads current registrations with `queryOnce`:

```ts
const regs = await queryOnce((q) =>
  q
    .from({ reg: this.requireRegistrationsCollection() })
    .where(({ reg }) =>
      and(eq(reg.tenantId, resolvedTenantId), eq(reg.sourceUrl, sourceUrl))
    )
)
```

`queryOnce` is async because a source collection may need preload. In the registry’s normal runtime path the collection is already loaded, so this should usually be a cheap microtick async boundary.

The existing condition matching and wake result construction can remain mostly unchanged:

- `runFinished` matches terminal run updates
- collection-change conditions match collection names and ops
- immediate matches return `WakeEvalResult[]`
- debounced matches append to debounce buffers
- timeout timers are cleared when the expected event arrives first

No code path should reload all registrations from Postgres on an evaluation miss.

## Timeout wake side effects

Wake registration `timeoutMs` measures how long a registration has been waiting for its matching source event. If that event does not arrive before `createdAt + timeoutMs`, the subscriber receives a timeout wake:

```ts
wakeMessage: {
  source: reg.sourceUrl,
  timeout: true,
  changes: [],
}
```

Use `createEffect` over the registration collection to manage these Node timers:

```ts
createEffect({
  query: (q) => q.from({ reg: registrationsCollection }),
  skipInitial: false,
  onEnter: ({ value }) => syncTimeoutTimer(value),
  onUpdate: ({ value }) => syncTimeoutTimer(value),
  onExit: ({ value }) => clearRegistrationState(value),
})
```

Timer behavior:

- On enter/update, if `timeoutMs <= 0` or `timeoutConsumed`, ensure no timer is active.
- If `createdAt + timeoutMs` is in the future, schedule one Node timer.
- If the deadline has already passed and the timeout has not been delivered, deliver the timeout wake once if a tenant callback is registered.
- On exit, clear timeout/debounce state and remove the row from `timeoutDelivered`.

When a timeout fires, it delivers the existing timeout wake result and invokes `markTimeoutConsumedAction`.

## Error handling

- Startup fails if the Electric collection preload fails.
- Local-only unit-test initialization should not perform DB I/O.
- Runtime startup without an Electric URL fails clearly; there is no Postgres-seeded fallback.
- Awaited public mutation methods reject if persistence fails; TanStack DB rolls back optimistic state.
- Fire-and-forget action failures are logged with enough context to diagnose the row and intent.
- Electric collection owns Shape lifecycle and retry behavior. `WakeRegistry` should not reimplement Shape recovery.
- Evaluation misses are not retried by reloading all rows from Postgres.

## Call-site changes

- Update every `wakeRegistry.evaluate(...)` call to `await wakeRegistry.evaluate(...)`.
- Remove `EntityManager.evaluateWakes()` retry/reload-on-cache-miss logic.
- Remove `loadRegistrations()` and update startup paths to require `startSync(...)` for runtime.
- Keep `flushDebounce(...)` synchronous unless it starts reading registration rows. It currently only drains debounce buffers.

## Test plan

Update existing wake registry unit tests:

- Convert direct `registry.evaluate(...)` assertions to `await registry.evaluate(...)`.
- Preserve coverage for:
  - tenant scoping
  - `runFinished` matching
  - collection-change matching
  - debounce coalescing
  - timeout delivery
  - timeout not consumed before callback registration
  - one-shot cleanup
  - unregister variants
  - `includeResponse`
  - concurrent child `runFinished` delivery

Remove or replace tests that only cover manual Shape cache machinery:

- direct `applyShapeMessage` tests
- malformed Shape message handling
- custom Shape recovery behavior

Add TanStack DB-specific tests:

- `registerAction` preallocates an id, inserts into the local collection, and `evaluate()` sees it through `queryOnce`.
- Each bulk unregister action removes all matching rows optimistically.
- One-shot cleanup removes matched rows before a second immediate evaluation.
- `markTimeoutConsumedAction` prevents repeat timeout delivery.
- Local-only unit tests require no Postgres, Electric, or Electric mock.

Add or keep an integration-style Electric test if practical:

- registry A registers a wake through Postgres/Electric collection
- registry B observes the row through Electric collection
- a terminal child run event evaluated by registry B produces the parent wake without any reload-on-miss fallback

## Files likely touched

- `packages/agents-server/package.json`
  - add `@tanstack/db`
  - add `@tanstack/electric-db-collection`
- `packages/agents-server/src/wake-registry.ts`
  - main refactor
- `packages/agents-server/src/entity-manager.ts`
  - await async evaluation and remove reload-on-miss fallback
- `packages/agents-server/test/wake-registry.test.ts`
  - update async assertions and action expectations
- `packages/agents-server/test/wake-registry-sync.test.ts`
  - remove/replace manual Shape tests with Postgres + Electric integration coverage where needed
- `.changeset/*`
  - update package changeset if implementation changes dependencies or behavior

## Acceptance criteria

- `WakeRegistry` has no authoritative `Map<string, CachedWakeRegistration[]>` cache.
- `WakeRegistry` does not instantiate `Shape` or `ShapeStream` directly.
- Runtime registration state comes from an Electric TanStack DB collection.
- Unit-test registration state comes from a local-only TanStack DB collection.
- Runtime startup without Electric fails instead of calling `loadRegistrations()`.
- All public registry mutations invoke optimistic actions.
- Bulk unregister operations are one action per domain intent.
- Runtime mutation handlers return/await real Postgres txids.
- Wake evaluation uses `queryOnce` over the collection.
- Timeout wake timers are driven by `createEffect` over collection rows.
- `EntityManager` no longer reloads registrations on terminal evaluation miss.
- Existing wake registry behavior tests pass after async/action updates.
