# Generic Writable Custom Collections (with Comments as a consumer)

Date: 2026-06-10
Status: Approved design — pending implementation plan
Branch: `vbalegas/custom-state`

## Motivation

PR #4529 ("feat(agents): Add session comments to agent timelines") adds comments
to agent sessions by **hardcoding** a `comments` collection into the built-in
entity schema: a `Comment*` type family in `entity-schema.ts`, a
`BUILT_IN_EVENT_SCHEMAS.comment`, a bespoke `EntityManager.createComment`, and a
dedicated `POST /:type/:instanceId/comments` route.

This design reaches the same end-user feature through a **generic, extensible
interface**: arbitrary _custom collections_ layered on the agent's entity state
stream. Comments becomes just one such collection that the Horton and worker
entity definitions declare. The generic interface adds three things the agent
runtime does not have today:

1. **Opt-in router-writable collections.** Entity state is owned by the agent.
   A collection is writable from the HTTP router only when it explicitly opts in
   via a `writable` safeguard. Everything else stays agent-only by default.
2. **Authenticated, auditable writes.** Router writes require authentication. The
   server stamps the authenticated principal into the **change-event header**
   (provenance, outside the user-supplied payload). The client materializes that
   header into a read-only **virtual column** on the collection row.
3. **Schema-validated writes.** Each custom collection carries a schema. Router
   writes validate the user payload against it server-side before the event is
   appended to the stream.

## Background: how change events and headers work

Every entity write is appended to the entity's **main durable stream** as a
JSON-encoded **change-event envelope** (`EntityManager.encodeChangeEvent` →
`JSON.stringify`). The shape:

```jsonc
{
  "type": "state:comments", // which collection/event-type this row belongs to
  "key": "comment-abc", // the row's primary key
  "headers": {
    // metadata ABOUT the write — not user data
    "operation": "insert", // insert | update | delete
    "timestamp": "2026-06-10T…Z",
    "offset": "…", // stamped by the stream; drives ordering
  },
  "value": { "body": "looks good" }, // the row payload (user data)
}
```

On the **client** (`entity-stream-db.ts`), `materializeEventRow` builds a
TanStack DB collection row purely from `value` plus the primary key:

```js
row = { ...event.value, [primaryKey]: event.key }
```

The only header projected onto a row today is `offset`, transformed into the
synthetic `_timeline_order` field. **There is no general header → column
mechanism.** This design adds one, modeled exactly on `_timeline_order`.

### Why principal goes in the header, not the value

PR #4529 puts `from_principal` inside `value`, conflating _who wrote this_
(provenance the server vouches for) with _what they wrote_ (user data validated
against the collection schema). Putting the principal in `headers` instead:

- the server stamps it authoritatively from the authenticated request;
- it sits outside the user's schema, so a client cannot spoof it by crafting a
  different `value`;
- the collection's data schema stays clean (no principal field to validate).

## Design

### 1. Change-event header API (foundation)

**Server** stamps a `principal` header on every router write:

```jsonc
{
  "type": "state:comments",
  "key": "comment-abc",
  "headers": {
    "operation": "insert",
    "timestamp": "2026-06-10T…Z",
    "principal": {
      // NEW — from the authenticated request
      "url": "/principal/user%3Aalice",
      "kind": "user",
      "id": "alice",
    },
  },
  "value": { "body": "looks good", "timestamp": "…" }, // NO principal here
}
```

**Client** generalizes `materializeEventRow`: if a collection declares a
`principalColumn`, copy `headers.principal` onto the row under that name.

```js
row = { ...event.value, [primaryKey]: event.key }
if (principalColumn) row[principalColumn] = event.headers?.principal
// e.g. row._principal = { url, kind, id }
```

The virtual column is read-only and server-vouched; it is never part of `value`
and never written by the client.

### 2. Collection definition + `writable` safeguard

Extend the runtime `CollectionDefinition` (`packages/agents-runtime/src/types.ts`)
with one optional field:

```ts
interface CollectionDefinition {
  schema?: StandardSchemaV1
  type?: string
  primaryKey?: string
  writable?: boolean | { principalColumn?: string } // NEW
}
```

- `writable` **absent or `false`** → the `/collections` endpoint rejects all
  writes. This is the default for all existing state.
- `writable: true` → router-writable; `principalColumn` defaults to `_principal`.
- `writable: { principalColumn: '_author' }` → router-writable with a custom
  virtual-column name.

At registration (`packages/agents-runtime/src/create-handler.ts`), alongside the
existing `state_schemas` map (keyed by event type), emit a parallel
**`writable_collections`** map keyed by **collection name** so the server can map
a URL `:collection` segment to its event type, schema, and column name:

```jsonc
"writable_collections": {
  "comments": { "type": "state:comments", "principalColumn": "_principal" }
}
```

`writable_collections` is stored as a new field on `ElectricAgentsEntityType`
(`packages/agents-server/src/electric-agents-types.ts`) and merges additively the
same way `state_schemas` does (see `amendSchemas` / `getEffectiveSchemas`).

### 3. Server write endpoint

`POST /:type/:instanceId/collections/:collection`

Registered in `packages/agents-server/src/routing/entities-router.ts`, with the
same middleware chain as `send`:

```
withExistingEntity → withSchema(writeCollectionBodySchema) → withEntityPermission('write')
```

Request body (single POST, operation in the body):

```jsonc
{ "operation": "insert", "key": "…(optional for insert)", "value": { … } }
```

`operation` ∈ `insert | update | delete`. Any principal with entity `write`
permission may perform any operation. **No author/ownership checks** — writes are
auditable via the stamped principal header, not gated by authorship.

Handler `writeCollection` (in `EntityManager`), in order:

1. Resolve `:collection` against the entity type's `writable_collections`.
   **Not found → 403** (`Collection is not writable`). This is the core safeguard.
2. `rejectsNormalWrites(entity.status)` → **409** (entity stopping/stopped/killed).
3. Build the envelope: `type` = the collection's registered event type,
   `key` (provided or generated), `headers = { operation, timestamp, principal }`
   where `principal = { url, kind, id }` from `ctx.principal`, and `value`.
4. `validateWriteEvent(entity, envelope)` → **422** if `type` is not a registered
   state schema or `value` fails it. (See §4.)
5. `encodeChangeEvent` → `streamClient.append(entity.streams.main, …)`.
6. Return `201` (insert) / `200` (update/delete) with `{ key }`.

This handler **replaces** PR #4529's `createComment` method and `/comments` route
entirely.

### 4. Schema validation

The canonical state-write validator already exists:
`EntityManager.validateWriteEvent(entity, event)` (`entity-manager.ts:3562`). It
looks up `event.type` in the entity type's effective `state_schemas` and validates
`event.value` against the matching schema (for `delete` it validates `old_value`).

Today it is called from exactly one place — `routing/stream-append.ts`, the
durable-streams proxy path agents/adapters use to append state events. **PR #4529
bypassed it** (`createComment` appended directly), so comment writes were never
schema-validated. The generic handler closes that gap by calling
`validateWriteEvent` itself.

- **Where:** server-side, inside `writeCollection`, reusing `validateWriteEvent`.
- **When:** synchronously, after the writable/status checks and before
  `streamClient.append`.
- **What:** only `value` (the user payload) is validated, against the collection's
  registered schema. `headers.principal` is server-stamped provenance and is
  deliberately _not_ validated, so it cannot be spoofed. `update` validates the new
  `value`; `delete` carries only a key and skips payload validation.
- **Client-side:** the optimistic action MAY validate against the same Standard
  Schema for instant feedback, but it is advisory — the server is authoritative.

The registered `state_schema` therefore does double duty: it validates both
agent-internal state writes (via `stream-append.ts`) and router writes (via the
new handler) — one schema, one validator, two entry points.

### 5. Client write actions

Custom state collections **already** auto-generate `${name}_insert / _update /
_delete` TanStack DB actions in `entity-stream-db.ts`. For writable collections
these become the optimistic write path:

1. UI calls the action → optimistic local insert/update/delete.
2. Action's `mutationFn` POSTs to `/collections/:collection`.
3. The synced stream row reconciles the optimistic row.
4. `materializeEventRow` attaches `_principal` (virtual column) when the synced
   row arrives.

No new client write primitive is needed beyond wiring the action's `mutationFn` to
the new endpoint.

### 6. Comments as a consumer of the generic interface

- **Remove** the hardcoded `comments` collection: the `Comment*` types,
  `BUILT_IN_EVENT_SCHEMAS.comment`, the `comments` entry in `builtInCollections` /
  `ENTITY_COLLECTIONS`, and `EntityManager.createComment` + `/comments` route.
- **Declare** `comments` as a custom `state` collection on the Horton and worker
  entity definitions, with the comment schema (body, `reply_to`,
  `target_snapshot`, edit/delete metadata) and
  `writable: { principalColumn: '_principal' }`.
- `useEntityTimeline` projects the `comments` collection into the timeline (as in
  #4529), reading the author from the `_principal` virtual column instead of
  `value.from_principal`.
- The **UI is cloned verbatim from #4529** (`CommentBubble`, `MessageInput` reply
  mode, `EntityTimeline` comment rows, comments-only view, reply previews) and
  layered on the generic collection. Only the data source changes.
- The #4529 branch will be cloned to `~/workspace/tmp-1` to lift the UI files
  exactly.

## Scope

Packages touched:

- `@electric-ax/agents-runtime` — `CollectionDefinition.writable`; generalized
  `materializeEventRow` (header → virtual column); registration emits
  `writable_collections`; comment schema moved to a custom state collection
  declared by Horton/worker.
- `@electric-ax/agents-server` — `writable_collections` on `ElectricAgentsEntityType`;
  `writeCollection` handler + `/collections/:collection` route; reuse of
  `validateWriteEvent` on the router path; removal of `createComment` + `/comments`.
- `@electric-ax/agents-server-ui` — comments UI cloned from #4529, sourced from
  the generic collection + `_principal`.

## Testing

- Writable-vs-non-writable gating: non-writable collection → 403; unknown
  collection → 403.
- Principal-header stamping: appended event carries `headers.principal = {url,
kind, id}` from the authenticated principal; `value` contains no principal.
- Virtual-column materialization: synced row exposes `_principal`; column is absent
  when the collection declares no `principalColumn`.
- Schema validation on the router path: invalid `value` → 422; valid `value`
  appends; `delete` skips payload validation.
- Operations: insert/update/delete each append with the correct
  `headers.operation`; any authenticated writer succeeds (no author check).
- Comments timeline projection: comment rows interleave in timeline order; author
  rendered from `_principal`.
- Cloned UI tests from #4529 adapted to the generic data source.

A changeset covering all touched packages is added.

## Decisions (resolved during brainstorming)

- **Write URL:** `POST /:type/:instanceId/collections/:collection` (generic
  `collections` noun, decoupled from the word "state").
- **Safeguard:** `writable?: boolean | { principalColumn?: string }` on the
  collection definition; boolean opt-in, no per-operation list.
- **Permissions:** any principal with entity `write` permission may
  insert/update/delete; no author/ownership checks.
- **Principal header:** structured `{ url, kind, id }`, surfaced under a
  configurable `principalColumn` (default `_principal`).
- **Endpoint shape:** single `POST` with `operation` in the body.
- **Validation:** server-authoritative via `validateWriteEvent`, validating `value`
  only; principal header excluded from validation.
