# Living Wiki shared-state schema discovery

Date: 2026-06-03

Task: Task 1 discovery from `docs/superpowers/plans/2026-06-03-living-wiki-shared-state-schema.md`.

## Skills and source read

Skills/listing:

- Ran `npx @tanstack/intent@latest list`.
  - Relevant installed skills found: `@durable-streams/state#state-schema`, `@durable-streams/state#stream-db`, `@electric-ax/agents-runtime#entity-stream-queries`, `@tanstack/db#db-core/collection-setup`, `@tanstack/db#db-core/live-queries`, `@tanstack/react-db#react-db`.
  - Noted version warnings: multiple installed variants of `@tanstack/db`, `@tanstack/react-db`, and `@electric-sql/client`; Living Wiki package itself depends on `@tanstack/db` and `@tanstack/react-db` but not currently `@durable-streams/state`.
- Loaded/read relevant skills with:
  - `pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/collection-setup @tanstack/db#db-core/live-queries @tanstack/react-db#react-db @durable-streams/state#state-schema @durable-streams/state#stream-db @electric-ax/agents-runtime#entity-stream-queries`
- Also read required plan/context files:
  - `docs/superpowers/plans/2026-06-03-living-wiki-shared-state-schema.md`
  - `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy-discovery.md`
  - `examples/living-wiki/README.md`
- Source files inspected:
  - `node_modules/.pnpm/@durable-streams+state@0.2.9_typescript@5.9.3/node_modules/@durable-streams/state/src/index.ts`
  - `node_modules/.pnpm/@durable-streams+state@0.2.9_typescript@5.9.3/node_modules/@durable-streams/state/src/stream-db.ts`
  - `packages/agents-runtime/src/observation-sources.ts`
  - `packages/agents-runtime/src/agents-client.ts`
  - `packages/agents-runtime/src/entity-stream-db.ts`
  - `packages/agents-runtime/src/runtime-server-client.ts`
  - `packages/agents-runtime/src/types.ts`
  - `packages/agents-runtime/src/process-wake.ts`
  - `packages/agents-runtime/src/observation-schema.ts`
  - `examples/deep-survey/src/server/orchestrator.ts`
  - `examples/deep-survey/src/ui/hooks/useSwarm.ts`
  - `examples/living-wiki/src/app/api/agentsProxyApi.ts`
  - `examples/living-wiki/src/shared/space.ts`
  - `examples/living-wiki/src/shared/agents-proxy.ts`
  - `examples/living-wiki/src/worker/agents-proxy/routes.ts`
  - `examples/living-wiki/src/worker/agents-proxy/targets.ts`
  - `examples/living-wiki/src/worker/agents-proxy/allowlists.test.ts`

Living Wiki package identity confirmed in `examples/living-wiki/package.json`: `@electric-ax/example-living-wiki`; scripts include `test`, `typecheck`, `build`.

## Exact imports and API signatures to use

Use the concrete `@durable-streams/state` exports, not Agents runtime's entity-level optional schema type, for the shared/browser state collection definitions:

```ts
import {
  createStateSchema,
  createStreamDB,
  type CollectionDefinition,
  type CreateStreamDBOptions,
  type StreamDB,
} from '@durable-streams/state'
```

Installed source exports these from `@durable-streams/state/src/index.ts`.

Relevant installed signatures from `src/stream-db.ts`:

```ts
export interface CollectionDefinition<T = unknown> {
  schema: StandardSchemaV1<T>
  type: string
  primaryKey: string
}

export type StreamStateDefinition = Record<string, CollectionDefinition>

export function createStateSchema<
  T extends Record<string, CollectionDefinition>,
>(collections: T): StateSchema<T>

export interface CreateStreamDBOptions<
  TDef extends StreamStateDefinition = StreamStateDefinition,
  TActions extends Record<string, ActionDefinition<any>> = Record<
    string,
    never
  >,
> {
  streamOptions?: DurableStreamOptions
  stream?: DurableStream
  live?: LiveMode
  state: TDef
  actions?: ActionFactory<TDef, TActions>
  onEvent?: (event: ChangeEvent) => void
  onBeforeBatch?: (batch: JsonBatch<StateEvent>) => void
  onBatch?: (batch: JsonBatch<StateEvent>) => void
}

export function createStreamDB<
  TDef extends StreamStateDefinition,
  TActions extends Record<string, ActionDefinition<any>> = Record<
    string,
    never
  >,
>(
  options: CreateStreamDBOptions<TDef, TActions>
): TActions extends Record<string, never>
  ? StreamDB<TDef>
  : StreamDBWithActions<TDef, TActions>
```

Event helper signatures added by `createStateSchema()`:

```ts
insert(params: { key?: string; value: T; headers?: Omit<Record<string, string>, 'operation'> }): ChangeEvent<T>
update(params: { key?: string; value: T; oldValue?: T; headers?: Omit<Record<string, string>, 'operation'> }): ChangeEvent<T>
delete(params: { key?: string; oldValue?: T; headers?: Omit<Record<string, string>, 'operation'> }): ChangeEvent<T>
upsert(params: { key?: string; value: T; headers?: Omit<Record<string, string>, 'operation'> }): ChangeEvent<T>
```

`@durable-streams/state` also re-exports TanStack DB helpers such as `createTransaction`, `queryOnce`, `createLiveQueryCollection`, comparison operators, and aggregate helpers. If append-payload tests need event construction, prefer the `createStateSchema(...).collection.insert/update/delete/upsert` helpers over hand-built envelopes.

## Is `createStateSchema(livingWikiStateCollections)` correct?

Yes, provided `livingWikiStateCollections` is a `Record<string, CollectionDefinition>` where every collection definition has all of:

- `schema`: a Standard Schema validator. Zod schemas satisfy this.
- `type`: the event `type` string in durable stream change events.
- `primaryKey`: the property name to use as the TanStack DB key; use `id` for the planned Living Wiki rows.

`createStateSchema()` expects an object keyed by collection names, validates there are no reserved collection names and no duplicate event `type` values, and returns the same collection definitions enhanced with `insert/update/delete/upsert` helpers. It is therefore reasonable to export both `livingWikiStateCollections` and `livingWikiStateSchema = createStateSchema(livingWikiStateCollections)`.

Conservative detail: pass `livingWikiStateSchema` as the `state` to `createStreamDB()` if helper methods might be useful to consumers/tests. The installed `createStreamDB()` only requires the base definition shape and will also accept `livingWikiStateCollections`; the enhanced schema is a structural superset.

## Browser helper approach: direct `createStreamDB` vs Agents `observe(db(...))`

Chosen recommendation for `examples/living-wiki/src/app/db/wikiStateDb.ts`: use direct `createStreamDB()` against the Living Wiki Worker proxy URL.

Recommended construction:

```ts
createStreamDB({
  streamOptions: {
    url: getObserveUrl({ wikiSpaceId, observeKind: 'shared-state' }),
    contentType: 'application/json',
  },
  state: livingWikiStateSchema,
})
```

Rationale:

- `packages/agents-runtime/src/observation-sources.ts` defines `db(id, schema)` to call `getSharedStateStreamPath(id)` and set `streamUrl` to `/_electric/shared-state/${id}`.
- `packages/agents-runtime/src/agents-client.ts` implements `client.observe(db(...))` by calling `createStreamDB({ streamOptions: { url: appendPathToUrl(baseUrl, source.streamUrl), contentType: 'application/json' }, state: normalizeObservationSchema(source.schema) })` and then `await db.preload()`.
- Using Agents `observe(db(...))` from the browser would require the browser to know or derive the raw shared-state id (`living-wiki:${wikiSpaceId}`) and rely on Worker compatibility for `/_electric/shared-state/:id` paths. That conflicts with the Living Wiki proxy boundary goal: the browser should only use `/api/observe/:wikiSpaceId/shared-state`, while the Worker derives `living-wiki:${wikiSpaceId}` server-side in `examples/living-wiki/src/worker/agents-proxy/targets.ts`.
- The existing Living Wiki browser URL helper `getObserveUrl({ wikiSpaceId, observeKind: 'shared-state' })` returns `/api/observe/${wikiSpaceId}/shared-state` and optionally appends durable-stream protocol params. The Worker allowlist tests confirm only durable-stream read params (`offset`, `live`, `cursor`) are forwarded.

Runtime/entity code should still use Agents `ctx.mkdb(...)` and `ctx.observe(db(...))` where it runs inside the Agents runtime. Example confirmed in `examples/deep-survey/src/server/orchestrator.ts`.

## Testing `wikiStateDb.ts` without opening network streams

`createStreamDB()` is synchronous and only opens/starts the durable stream when `db.preload()` is called. The installed source comment says it creates the stream handle and collections but does not start the stream connection; `preload()` starts consuming.

Testing options, in increasing isolation:

1. Dependency-inject the factory. Export a helper that accepts a `createStreamDB`-compatible dependency and assert it is called with the expected `streamOptions.url`, `contentType`, and `state`. Do not call `preload()`.
2. Module mock `@durable-streams/state` in Vitest and import the helper after mocking. This is acceptable but couples tests to module loading order.
3. If constructing a real DB is desired, pass a fake `stream` through `CreateStreamDBOptions['stream']` only in a lower-level test. That fake must satisfy the `DurableStream` interface enough for `stream.url` and possibly `stream.stream()` if `preload()` is called. For this phase, avoid calling `preload()` in unit tests unless specifically testing stream consumption.

Recommended implementation: support injection in `createWikiStateDb` or a lower-level `createWikiStateDbWithOptions` function, and keep tests limited to construction invariants and proxy URL/security invariants.

## API uncertainties / blockers

- Dependency gap: `examples/living-wiki/package.json` currently does not list `@durable-streams/state` as a dependency. The workspace has it installed via other packages, but Living Wiki implementation should add an explicit dependency before importing it from Living Wiki source.
- Exact `DurableStreamOptions` details: for the planned browser helper only `url` and `contentType: 'application/json'` are needed and match Agents client usage. No additional stream options were discovered as necessary.
- CollectionDefinition type name collision: `packages/agents-runtime/src/types.ts` also exports an entity-level `CollectionDefinition` where `schema`, `type`, and `primaryKey` are optional. Do not use that type for Living Wiki shared schema definitions. Use `@durable-streams/state`'s `CollectionDefinition`, which requires all three fields.
- Event type convention: Agents runtime blackboard skill recommends `shared:<name>` for generic shared collections. The Living Wiki plan proposes singular event types such as `wiki_space`, `activity_event`, etc. The durable-state API only requires uniqueness; no source-enforced prefix requirement was found. If cross-stream inspection needs obvious shared-state provenance, consider prefixing, but that would be a product/schema decision, not an API requirement.

## Red-flag scan

Performed a red-flag scan of the discovery note for common forbidden placeholder, credential, and debug markers without embedding the literal marker strings in the command. The only match was terminology in this red-flag-scan sentence itself; no actionable placeholder, credential, or debug marker was found.
