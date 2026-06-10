# Generic Writable Custom Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach PR #4529's comments feature through a generic, extensible custom-collection interface — opt-in router-writable entity-state collections with authenticated, schema-validated writes whose principal is stamped into the change-event header and materialized into a virtual column.

**Architecture:** Three layers. (A) **Runtime**: a `writable` flag on the entity `CollectionDefinition`, a header→virtual-column projection in the entity stream DB, and a `writable_collections` registration map. (B) **Server**: storage of `writable_collections` on the entity type, a generic `EntityManager.writeCollection` method, and a `POST /:type/:instanceId/collections/:collection` route that authenticates, stamps the principal header, and validates the payload via the existing `validateWriteEvent`. (C) **Comments as a consumer**: comments declared as a custom `state` collection on the Horton and worker entity definitions, with the #4529 UI cloned verbatim and re-sourced onto the generic collection.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod / Standard Schema, TypeBox (`@sinclair/typebox` `Type.*`), TanStack DB, `@durable-streams/state`.

**Spec:** `docs/superpowers/specs/2026-06-10-generic-writable-collections-design.md`

**Reference clone:** PR #4529 is cloned at `~/workspace/tmp-1` (branch `codex/session-comments`). Its full diff is at `/tmp/pr4529.diff`. Use these to lift UI files verbatim in Phase C.

---

## File Structure

**Phase A — Runtime (`packages/agents-runtime/src/`)**

- Modify `types.ts` — add `writable` to `CollectionDefinition` (one responsibility: type definitions).
- Modify `entity-stream-db.ts` — build a `principalColumnByCollection` map and project `headers.principal` onto rows in both materialization paths.
- Modify `create-handler.ts` — emit `writable_collections` in the registration body.

**Phase B — Server (`packages/agents-server/src/`)**

- Modify `electric-agents-types.ts` — add `writable_collections` to `ElectricAgentsEntityType` + `RegisterEntityTypeRequest`.
- Modify `routing/entity-types-router.ts` — accept/normalize `writable_collections` in the register body and persist it.
- Modify `entity-manager.ts` — `registerEntityType` stores `writable_collections`; `getEffectiveSchemas` (rename usage) exposes effective `writable_collections`; new `writeCollection` method.
- Modify `routing/entities-router.ts` — `writeCollectionBodySchema`, the `/collections/:collection` route, and the `writeCollection` handler.

**Phase C — Comments consumer**

- Create `packages/agents-runtime/src/comments-collection.ts` — comment Zod schema, `Comment` types, and the reusable `commentsCollection` definition. (Replaces the hardcoded comment schema removed from `entity-schema.ts`.)
- Modify `packages/agents-runtime/src/entity-schema.ts` — remove the hardcoded `comments` built-in collection.
- Modify `packages/agents-runtime/src/index.ts` — export the comments-collection module.
- Modify `packages/agents-runtime/src/entity-timeline.ts` — project the custom `comments` collection using `_principal`.
- Modify `packages/agents/src/agents/horton.ts` and `worker.ts` — declare `state: { comments: commentsCollection }`.
- Modify `packages/agents-server-ui/src/...` — clone the #4529 UI and re-source onto the generic collection.

---

## Phase A — Runtime generic interface

### Task A1: Add `writable` to `CollectionDefinition`

**Files:**

- Modify: `packages/agents-runtime/src/types.ts:632-642`

- [ ] **Step 1: Add the field**

In `packages/agents-runtime/src/types.ts`, extend the `CollectionDefinition` interface (currently lines 632-642) so it reads:

```ts
export interface CollectionDefinition<
  TSchema extends StandardSchemaV1<any, any> | undefined =
    | StandardSchemaV1<any, any>
    | undefined,
> {
  schema?: TSchema
  /** Event type string used in the durable stream (e.g. `"counter_value"`). Defaults to `"state:${name}"`. */
  type?: string
  /** Primary key field name. Defaults to `"key"`. */
  primaryKey?: string
  /**
   * Opt-in for HTTP-router writes via `POST /:type/:instanceId/collections/:name`.
   * Absent/false ⇒ collection is agent-only and the endpoint rejects writes.
   * `true` ⇒ writable; the principal is materialized into the `_principal` column.
   * Object form lets a collection rename that virtual column.
   */
  writable?: boolean | { principalColumn?: string }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @electric-ax/agents-runtime run typecheck`
Expected: PASS (purely additive optional field).

- [ ] **Step 3: Commit**

```bash
git add packages/agents-runtime/src/types.ts
git commit -m "feat(agents-runtime): add writable flag to CollectionDefinition"
```

---

### Task A2: Project `headers.principal` into a virtual column

The entity stream DB injects synthetic fields into `event.value` before materialization in two places: the wire-batch path (`onBeforeBatch`, ~lines 325-356) and the in-process `applyEvent` path (~lines 711-730). We add a parallel `principalColumnByCollection` map and inject `headers.principal` the same way `_timeline_order` is injected.

**Files:**

- Modify: `packages/agents-runtime/src/entity-stream-db.ts`
- Test: `packages/agents-runtime/test/entity-stream-db-principal.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/agents-runtime/test/entity-stream-db-principal.test.ts`. (Model the harness on the existing `packages/agents-runtime/test/entity-timeline.test.ts` — read it first for how a stream DB is constructed and how batches are delivered.) The test declares a writable custom collection and asserts the principal header lands in the configured column while a non-writable collection does not get the column:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createEntityStreamDB } from '../src/entity-stream-db'

function principalHeader() {
  return { url: `/principal/user%3Aalice`, kind: `user`, id: `alice` }
}

describe(`entity-stream-db principal virtual column`, () => {
  it(`projects headers.principal onto the configured column for writable collections`, () => {
    const db = createEntityStreamDB(`/chat/sess-1`, {
      comments: {
        schema: z.object({ key: z.string().optional(), body: z.string() }),
        writable: { principalColumn: `_principal` },
      },
    })

    db.utils.applyEvent({
      type: `state:comments`,
      key: `c1`,
      headers: { operation: `insert`, principal: principalHeader() },
      value: { body: `hi` },
    } as any)

    const row = db.collections.comments.get(`c1`) as Record<string, unknown>
    expect(row.body).toBe(`hi`)
    expect(row._principal).toEqual(principalHeader())
  })

  it(`does not add a principal column when the collection is not writable`, () => {
    const db = createEntityStreamDB(`/chat/sess-2`, {
      notes: {
        schema: z.object({ key: z.string().optional(), body: z.string() }),
      },
    })

    db.utils.applyEvent({
      type: `state:notes`,
      key: `n1`,
      headers: { operation: `insert`, principal: principalHeader() },
      value: { body: `hi` },
    } as any)

    const row = db.collections.notes.get(`n1`) as Record<string, unknown>
    expect(row._principal).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @electric-ax/agents-runtime exec vitest run test/entity-stream-db-principal.test.ts`
Expected: FAIL — first test's `row._principal` is `undefined`.

- [ ] **Step 3: Build the `principalColumnByCollection` map**

In `packages/agents-runtime/src/entity-stream-db.ts`, inside `createEntityStreamDB`, in the loop that converts `customState` (currently lines ~131-138, the `for (const [name, def] of Object.entries(customState))` block), capture the principal column. Add a map declaration just above the loop and populate it:

```ts
const streamCustomState: Record<string, CollectionDefinition> = {}
const principalColumnByCollection = new Map<string, string>()
if (customState) {
  for (const [name, def] of Object.entries(customState)) {
    streamCustomState[name] = {
      schema: def.schema ?? passthrough(),
      type: def.type ?? `state:${name}`,
      primaryKey: def.primaryKey ?? `key`,
    }
    if (def.writable) {
      principalColumnByCollection.set(
        name,
        def.writable === true
          ? `_principal`
          : (def.writable.principalColumn ?? `_principal`)
      )
    }
  }
}
```

- [ ] **Step 4: Inject in the wire-batch path**

In the `onBeforeBatch` handler, immediately after the `_timeline_order` injection block (currently ending at line 356 `;(item.value as Record<string, unknown>)._timeline_order = order`), add:

```ts
const principalColumn = principalColumnByCollection.get(collectionName)
if (principalColumn) {
  const principal = (item.headers as Record<string, unknown>).principal
  if (principal !== undefined) {
    ;(item.value as Record<string, unknown>)[principalColumn] = principal
  }
}
```

- [ ] **Step 5: Inject in the `applyEvent` path**

In `applyEvent`, after the `_timeline_order` injection (currently ending at line 729 `;(event.value as Record<string, unknown>)._timeline_order = order`) — and still inside the `if (event.headers.operation !== 'delete' && ...)` block — add:

```ts
const principalColumn = principalColumnByCollection.get(collectionName)
if (principalColumn) {
  const principal = (event.headers as Record<string, unknown>).principal
  if (principal !== undefined) {
    ;(event.value as Record<string, unknown>)[principalColumn] = principal
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @electric-ax/agents-runtime exec vitest run test/entity-stream-db-principal.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-runtime run typecheck`
Expected: PASS

```bash
git add packages/agents-runtime/src/entity-stream-db.ts packages/agents-runtime/test/entity-stream-db-principal.test.ts
git commit -m "feat(agents-runtime): materialize principal header into virtual column"
```

---

### Task A3: Emit `writable_collections` at registration

**Files:**

- Modify: `packages/agents-runtime/src/create-handler.ts:488-519`
- Test: `packages/agents-runtime/test/create-handler-writable.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/agents-runtime/test/create-handler-writable.test.ts`. The registration body is computed per entity type from `definition.state`. Read `packages/agents-runtime/src/create-handler.ts` around lines 484-525 first to see how `types`, `serveEndpoint`, and the POST are wired, then write a focused unit test that calls the same body-building logic. If the body-building is inline (not exported), extract it into a small exported pure helper `buildEntityTypeRegistrationBody(name, definition)` as part of this task and test that:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildEntityTypeRegistrationBody } from '../src/create-handler'

describe(`buildEntityTypeRegistrationBody`, () => {
  it(`emits writable_collections for writable state collections only`, () => {
    const body = buildEntityTypeRegistrationBody(`chat`, {
      description: `chat`,
      handler: async () => {},
      state: {
        comments: {
          schema: z.object({ key: z.string().optional(), body: z.string() }),
          writable: { principalColumn: `_principal` },
        },
        scratch: {
          schema: z.object({ key: z.string().optional(), note: z.string() }),
        },
      },
    } as any)

    expect(body.writable_collections).toEqual({
      comments: { type: `state:comments`, principalColumn: `_principal` },
    })
  })

  it(`omits writable_collections when no collection opts in`, () => {
    const body = buildEntityTypeRegistrationBody(`chat`, {
      description: `chat`,
      handler: async () => {},
      state: {
        scratch: { schema: z.object({ note: z.string() }) },
      },
    } as any)
    expect(body.writable_collections).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @electric-ax/agents-runtime exec vitest run test/create-handler-writable.test.ts`
Expected: FAIL — `buildEntityTypeRegistrationBody` not exported / `writable_collections` undefined.

- [ ] **Step 3: Extract + extend the body builder**

In `packages/agents-runtime/src/create-handler.ts`, extract the per-type body construction (currently inline at ~lines 488-519) into an exported pure function above the registration loop, and compute `writable_collections` alongside `state_schemas`:

```ts
export function buildEntityTypeRegistrationBody(
  name: string,
  definition: AnyEntityDefinition
): Record<string, unknown> {
  const stateEntries = definition.state ? Object.entries(definition.state) : []

  const stateSchemas = Object.fromEntries(
    stateEntries.map(([collectionName, def]) => [
      def.type ?? `state:${collectionName}`,
      toJsonSchema(def.schema ?? passthrough()),
    ])
  )

  const writableCollections: Record<
    string,
    { type: string; principalColumn: string }
  > = {}
  for (const [collectionName, def] of stateEntries) {
    if (!def.writable) continue
    writableCollections[collectionName] = {
      type: def.type ?? `state:${collectionName}`,
      principalColumn:
        def.writable === true
          ? `_principal`
          : (def.writable.principalColumn ?? `_principal`),
    }
  }

  const body: Record<string, unknown> = {
    name,
    description: definition.description ?? `${name} entity`,
    ...(definition.creationSchema && {
      creation_schema: toJsonSchema(definition.creationSchema),
    }),
    ...(definition.inboxSchemas && {
      inbox_schemas: mapSchemas(definition.inboxSchemas),
    }),
    ...(definition.slashCommands && {
      slash_commands: definition.slashCommands,
    }),
    state_schemas: {
      ...DEFAULT_STATE_SCHEMAS,
      ...stateSchemas,
      ...(definition.stateSchemas ? mapSchemas(definition.stateSchemas) : {}),
    },
    ...(Object.keys(writableCollections).length > 0 && {
      writable_collections: writableCollections,
    }),
    ...(definition.permissionGrants && {
      permission_grants: definition.permissionGrants,
    }),
  }
  return body
}
```

Then in the registration loop, replace the inline body construction with `const body = buildEntityTypeRegistrationBody(name, definition)` and keep the subsequent mutations (`body.serve_endpoint = …`, etc.) as they are. Note: `mapSchemas`, `toJsonSchema`, `passthrough`, `DEFAULT_STATE_SCHEMAS` are already in scope in this file — keep using the existing references.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @electric-ax/agents-runtime exec vitest run test/create-handler-writable.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-runtime run typecheck`
Expected: PASS

```bash
git add packages/agents-runtime/src/create-handler.ts packages/agents-runtime/test/create-handler-writable.test.ts
git commit -m "feat(agents-runtime): emit writable_collections at entity-type registration"
```

---

## Phase B — Server generic interface

### Task B1: Store `writable_collections` on the entity type

**Files:**

- Modify: `packages/agents-server/src/electric-agents-types.ts:500-520` (`ElectricAgentsEntityType`, `RegisterEntityTypeRequest`)

- [ ] **Step 1: Add the type**

In `packages/agents-server/src/electric-agents-types.ts`, define a shared shape and add the field to both `ElectricAgentsEntityType` and `RegisterEntityTypeRequest`:

```ts
export interface WritableCollectionConfig {
  /** Durable-stream event type for this collection, e.g. `state:comments`. */
  type: string
  /** Row column the client materializes the principal header into. */
  principalColumn: string
}
```

Add to `ElectricAgentsEntityType` (after `state_schemas?`):

```ts
  writable_collections?: Record<string, WritableCollectionConfig>
```

Add the identical optional field to `RegisterEntityTypeRequest`.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-server run typecheck`
Expected: PASS

```bash
git add packages/agents-server/src/electric-agents-types.ts
git commit -m "feat(agents-server): add writable_collections to entity type"
```

---

### Task B2: Accept, persist, and resolve `writable_collections`

**Files:**

- Modify: `packages/agents-server/src/routing/entity-types-router.ts:47,83-97,448-...` (body schema + normalize)
- Modify: `packages/agents-server/src/entity-manager.ts:432-499` (`registerEntityType` stores it), `3871-3892` (`getEffectiveSchemas` → also return effective `writable_collections`)
- Test: `packages/agents-server/test/electric-agents-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `packages/agents-server/test/electric-agents-routes.test.ts`, add a test that registering an entity type with `writable_collections` round-trips it through the manager. Read the existing register-entity-type tests in that file first for the `routeResponse` / mock-manager harness, then add:

```ts
it(`persists writable_collections on entity type registration`, async () => {
  const registerEntityType = vi.fn().mockResolvedValue({
    name: `chat`,
    description: `chat`,
    revision: 1,
    created_at: `t`,
    updated_at: `t`,
    writable_collections: {
      comments: { type: `state:comments`, principalColumn: `_principal` },
    },
  })
  const manager = {
    registry: { getEntityType: vi.fn() },
    registerEntityType,
  } as any

  const response = await routeResponse(
    manager,
    `POST`,
    `/_electric/entity-types`,
    {
      name: `chat`,
      description: `chat`,
      writable_collections: {
        comments: { type: `state:comments`, principalColumn: `_principal` },
      },
    }
  )

  expect(response.status).toBe(201)
  expect(registerEntityType).toHaveBeenCalledWith(
    expect.objectContaining({
      writable_collections: {
        comments: { type: `state:comments`, principalColumn: `_principal` },
      },
    })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run test/electric-agents-routes.test.ts -t writable_collections`
Expected: FAIL — `additionalProperties: false` rejects `writable_collections`, or it is dropped by normalize.

- [ ] **Step 3: Add the body schema + normalize**

In `packages/agents-server/src/routing/entity-types-router.ts`, near `schemaMapSchema` (line 47) add:

```ts
const writableCollectionsSchema = Type.Record(
  Type.String(),
  Type.Object(
    {
      type: Type.String(),
      principalColumn: Type.String(),
    },
    { additionalProperties: false }
  )
)
```

Add `writable_collections: Type.Optional(writableCollectionsSchema),` to `registerEntityTypeBodySchema` (lines 83-97). In `normalizeEntityTypeRequest` (line 448), thread the field through onto the normalized request object (follow how `state_schemas` is carried). In `registerEntityType` (line ~173, where the normalized request is passed to `ctx.entityManager.registerEntityType`), ensure `writable_collections` is included — it already will be if `normalizeEntityTypeRequest` carries it.

- [ ] **Step 4: Store it in the manager**

In `packages/agents-server/src/entity-manager.ts`, in `registerEntityType` (lines 432-499), copy the field onto the stored entity type object next to `state_schemas: req.state_schemas`:

```ts
      writable_collections: req.writable_collections,
```

- [ ] **Step 5: Resolve effective writable_collections**

In `getEffectiveSchemas` (lines 3871-3892), extend the return to include `writableCollections`, merging entity-level then entity-type-level the same additive way as `stateSchemas`:

```ts
  private async getEffectiveSchemas(entity: ElectricAgentsEntity): Promise<{
    inboxSchemas?: Record<string, Record<string, unknown>>
    stateSchemas?: Record<string, Record<string, unknown>>
    writableCollections?: Record<string, WritableCollectionConfig>
  }> {
    if (!entity.type) {
      return {
        inboxSchemas: entity.inbox_schemas,
        stateSchemas: entity.state_schemas,
      }
    }
    const latestType = await this.registry.getEntityType(entity.type)
    return {
      inboxSchemas: latestType?.inbox_schemas
        ? { ...(entity.inbox_schemas ?? {}), ...latestType.inbox_schemas }
        : entity.inbox_schemas,
      stateSchemas: latestType?.state_schemas
        ? { ...(entity.state_schemas ?? {}), ...latestType.state_schemas }
        : entity.state_schemas,
      writableCollections: latestType?.writable_collections,
    }
  }
```

Import `WritableCollectionConfig` from `./electric-agents-types` at the top of `entity-manager.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run test/electric-agents-routes.test.ts -t writable_collections`
Expected: PASS

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-server run typecheck`
Expected: PASS

```bash
git add packages/agents-server/src/routing/entity-types-router.ts packages/agents-server/src/entity-manager.ts packages/agents-server/test/electric-agents-routes.test.ts
git commit -m "feat(agents-server): persist and resolve writable_collections"
```

---

### Task B3: `EntityManager.writeCollection`

**Files:**

- Modify: `packages/agents-server/src/entity-manager.ts` (new method near `createComment`'s old location / `send`, ~line 2285)
- Test: `packages/agents-server/test/electric-agents-manager-write-validation.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `packages/agents-server/test/electric-agents-manager-write-validation.test.ts`, model on the existing `ElectricAgentsManager comments` describe block (it has a `decodeAppendEvent` helper and the `createAttachmentManager`/manager harness). Add a `writeCollection` describe block:

```ts
describe(`ElectricAgentsManager.writeCollection`, () => {
  it(`stamps the principal header and appends a generic collection insert`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    // Make the entity type expose `comments` as writable with a passthrough schema.
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:comments': {} },
      writable_collections: {
        comments: { type: `state:comments`, principalColumn: `_principal` },
      },
    })

    const result = await manager.writeCollection(
      `/chat/session-1`,
      `comments`,
      {
        operation: `insert`,
        key: `c1`,
        value: { body: `hi` },
        principal: {
          url: `/principal/user%3Aalice`,
          kind: `user`,
          id: `alice`,
        },
      }
    )

    expect(result).toEqual({ key: `c1` })
    const event = decodeAppendEvent(append.mock.calls[0]?.[1])
    expect(event).toMatchObject({
      type: `state:comments`,
      key: `c1`,
      headers: {
        operation: `insert`,
        principal: {
          url: `/principal/user%3Aalice`,
          kind: `user`,
          id: `alice`,
        },
      },
      value: { body: `hi` },
    })
    expect(event.value.from_principal).toBeUndefined()
  })

  it(`rejects writes to a collection that is not writable`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:notes': {} },
      writable_collections: {},
    })

    await expect(
      manager.writeCollection(`/chat/session-1`, `notes`, {
        operation: `insert`,
        value: { note: `x` },
        principal: {
          url: `/principal/user%3Aalice`,
          kind: `user`,
          id: `alice`,
        },
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(append).not.toHaveBeenCalled()
  })
})
```

(If `createAttachmentManager` does not let you set `registry.getEntityType`, set it on the returned `manager.registry` object after construction, as shown.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run test/electric-agents-manager-write-validation.test.ts -t writeCollection`
Expected: FAIL — `manager.writeCollection` is not a function.

- [ ] **Step 3: Add the request types + method**

In `packages/agents-server/src/entity-manager.ts`, near the other request interfaces (~line 135), add:

```ts
export interface WriteCollectionPrincipal {
  url: string
  kind: string
  id: string
}

export interface WriteCollectionRequest {
  operation: `insert` | `update` | `delete`
  key?: string
  value?: Record<string, unknown>
  principal: WriteCollectionPrincipal
}

export interface WriteCollectionResult {
  key: string
}
```

Add the method (place it next to `send`, ~line 2335, or where `createComment` lived):

```ts
  async writeCollection(
    entityUrl: string,
    collection: string,
    req: WriteCollectionRequest
  ): Promise<WriteCollectionResult> {
    const entity = await this.registry.getEntity(entityUrl)
    if (!entity) {
      throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404)
    }

    const { writableCollections } = await this.getEffectiveSchemas(entity)
    const config = writableCollections?.[collection]
    if (!config) {
      throw new ElectricAgentsError(
        ErrCodeUnauthorized,
        `Collection "${collection}" is not writable`,
        403
      )
    }

    if (rejectsNormalWrites(entity.status)) {
      throw new ElectricAgentsError(
        ErrCodeNotRunning,
        `Entity is not accepting writes`,
        409
      )
    }

    if (req.operation !== `delete` && (req.value === undefined || req.value === null)) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `value is required for ${req.operation}`,
        400
      )
    }
    if (req.operation !== `insert` && !req.key) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        `key is required for ${req.operation}`,
        400
      )
    }

    const key =
      req.key ??
      `${collection}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const event: Record<string, unknown> = {
      type: config.type,
      key,
      headers: {
        operation: req.operation,
        timestamp: new Date().toISOString(),
        principal: req.principal,
      },
    }
    if (req.operation === `delete`) {
      // delete validation reads old_value; we don't have it here, so omit.
    } else {
      event.value = req.value
    }

    const validationError = await this.validateWriteEvent(entity, event)
    if (validationError) {
      throw new ElectricAgentsError(
        validationError.code,
        validationError.message,
        validationError.status
      )
    }

    const encoded = this.encodeChangeEvent(event)
    try {
      await this.streamClient.append(entity.streams.main, encoded)
    } catch (err) {
      if (this.isClosedStreamError(err)) {
        throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409)
      }
      throw err
    }

    return { key }
  }
```

Confirm the error-code identifiers (`ErrCodeNotFound`, `ErrCodeUnauthorized`, `ErrCodeNotRunning`, `ErrCodeInvalidRequest`) are already imported in this file (they are used by `createComment`/`send`); reuse them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run test/electric-agents-manager-write-validation.test.ts -t writeCollection`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-server run typecheck`
Expected: PASS

```bash
git add packages/agents-server/src/entity-manager.ts packages/agents-server/test/electric-agents-manager-write-validation.test.ts
git commit -m "feat(agents-server): generic writeCollection with principal-header stamping"
```

---

### Task B4: `/collections/:collection` route

**Files:**

- Modify: `packages/agents-server/src/routing/entities-router.ts` (body schema ~line 170, route ~line 421, handler ~line 1254)
- Test: `packages/agents-server/test/electric-agents-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `packages/agents-server/test/electric-agents-routes.test.ts`, model on the existing `comments endpoint` describe block and add:

```ts
describe(`ElectricAgentsRoutes collections endpoint`, () => {
  it(`routes a collection write to the manager with the authenticated principal`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
      writeCollection: vi.fn().mockResolvedValue({ key: `c1` }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/collections/comments`,
      { operation: `insert`, key: `c1`, value: { body: `hi` } }
    )

    expect(response.status).toBe(201)
    expect(await responseJson(response)).toEqual({ key: `c1` })
    expect(manager.writeCollection).toHaveBeenCalledWith(
      `/chat/test`,
      `comments`,
      expect.objectContaining({
        operation: `insert`,
        key: `c1`,
        value: { body: `hi` },
        principal: expect.objectContaining({ url: expect.any(String) }),
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run test/electric-agents-routes.test.ts -t "collections endpoint"`
Expected: FAIL — route not found (404) / `writeCollection` not called.

- [ ] **Step 3: Add the body schema**

In `packages/agents-server/src/routing/entities-router.ts`, near `sendBodySchema` (line 167), add:

```ts
const writeCollectionBodySchema = Type.Object(
  {
    operation: Type.Union([
      Type.Literal(`insert`),
      Type.Literal(`update`),
      Type.Literal(`delete`),
    ]),
    key: Type.Optional(Type.String()),
    value: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false }
)
```

Add the type alias near the others (line ~342): `type WriteCollectionBody = Static<typeof writeCollectionBodySchema>`.

- [ ] **Step 4: Register the route**

Near the `send` route registration (line ~403), add (the `:collection` param sits under a `collections/` segment so it cannot collide with sibling routes like `send`, `attachments`, `tags`):

```ts
entitiesRouter.post(
  `/:type/:instanceId/collections/:collection`,
  withExistingEntity,
  withSchema(writeCollectionBodySchema),
  withEntityPermission(`write`),
  writeCollection
)
```

- [ ] **Step 5: Add the handler**

Near `sendEntity` / the old `createComment` handler (line ~1254), add. Read `sendEntity` first to mirror how `ctx.principal` and `requireExistingEntityRoute` are used:

```ts
async function writeCollection(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<WriteCollectionBody>(request)
  await ctx.entityManager.ensurePrincipal(ctx.principal)
  const { entityUrl } = requireExistingEntityRoute(request)
  const collection = request.params.collection
  const result = await ctx.entityManager.writeCollection(
    entityUrl,
    collection,
    {
      operation: parsed.operation,
      key: parsed.key,
      value: parsed.value,
      principal: {
        url: ctx.principal.url,
        kind: ctx.principal.kind,
        id: ctx.principal.id,
      },
    }
  )
  return json(result, { status: parsed.operation === `insert` ? 201 : 200 })
}
```

Confirm `ctx.principal` exposes `url`, `kind`, `id` (it does — see `principal.ts` / `sendEntity`). If `id` is not directly present, derive it the same way `sendEntity` builds the principal subject.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run test/electric-agents-routes.test.ts -t "collections endpoint"`
Expected: PASS

- [ ] **Step 7: Full server test run + typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-server exec vitest run`
Expected: PASS (no regressions)
Run: `pnpm --filter @electric-ax/agents-server run typecheck`
Expected: PASS

```bash
git add packages/agents-server/src/routing/entities-router.ts packages/agents-server/test/electric-agents-routes.test.ts
git commit -m "feat(agents-server): POST /collections/:collection generic write route"
```

---

## Phase C — Comments as a consumer

### Task C1: Comments collection module

**Files:**

- Create: `packages/agents-runtime/src/comments-collection.ts`
- Modify: `packages/agents-runtime/src/index.ts`
- Reference: `/tmp/pr4529.diff` (the `entity-schema.ts` hunk: `CommentValue`, `CommentTargetValue`, `CommentSnapshotValue`, `createCommentSchema`)

- [ ] **Step 1: Create the module**

Create `packages/agents-runtime/src/comments-collection.ts`. Port the comment value/target/snapshot Zod schemas from the #4529 `entity-schema.ts` hunk in `/tmp/pr4529.diff` (the `createCommentSchema`, `createCommentTargetSchema`, `createCommentSnapshotSchema` functions and their `*Value` types), but **drop the `from_principal` field** — provenance now comes from the `_principal` virtual column. Export the schema, the value types, and a ready-to-use collection definition:

```ts
import { z } from 'zod'
import type { CollectionDefinition } from './types'

// ... CommentTargetValue, CommentSnapshotValue, CommentValue types and their
// z schemas, ported from /tmp/pr4529.diff WITHOUT `from_principal` ...

export const commentSchema = createCommentSchema()

export const commentsCollection: CollectionDefinition = {
  schema: commentSchema,
  type: `state:comments`,
  primaryKey: `key`,
  writable: { principalColumn: `_principal` },
}

export type { CommentValue, CommentTargetValue, CommentSnapshotValue }
```

Keep `timelineOrderField` semantics: the row carries `_timeline_order` automatically (injected by the stream DB), so it does **not** belong in the user-facing schema. Do not add it to `commentSchema`.

- [ ] **Step 2: Export from the barrel**

In `packages/agents-runtime/src/index.ts`, add: `export * from './comments-collection'`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-runtime run typecheck`
Expected: PASS

```bash
git add packages/agents-runtime/src/comments-collection.ts packages/agents-runtime/src/index.ts
git commit -m "feat(agents-runtime): comments collection definition on generic interface"
```

---

### Task C2: Remove the hardcoded comments built-in collection

**Files:**

- Modify: `packages/agents-runtime/src/entity-schema.ts` (revert the #4529 additions if present, or confirm absent on this branch)

> NOTE: This plan's branch (`vbalegas/custom-state`) does NOT contain #4529, so `entity-schema.ts` has **no** `comments` built-in collection to remove. If you are instead building on top of #4529, remove: the `Comment*` types, `createComment*Schema` functions, `BUILT_IN_EVENT_SCHEMAS.comment`, the `comments` entries in `ENTITY_COLLECTIONS` / `builtInCollections` / `EntityCollectionsDefinition`, and the `Comment*` exports. Verify against `/tmp/pr4529.diff`.

- [ ] **Step 1: Confirm clean state**

Run: `grep -n "comment" packages/agents-runtime/src/entity-schema.ts`
Expected on `vbalegas/custom-state`: no matches → nothing to remove; skip to Step 2. If matches exist (building on #4529), delete each per the note above.

- [ ] **Step 2: Typecheck + commit (only if changes were made)**

Run: `pnpm --filter @electric-ax/agents-runtime run typecheck`
Expected: PASS

```bash
git add packages/agents-runtime/src/entity-schema.ts
git commit -m "refactor(agents-runtime): drop hardcoded comments built-in collection"
```

---

### Task C3: Declare comments state on Horton and worker

**Files:**

- Modify: `packages/agents/src/agents/horton.ts` (the `registry.define('horton', {...})` call, ~line 759)
- Modify: `packages/agents/src/agents/worker.ts` (the `registry.define('worker', {...})` call, line 303)
- Test: `packages/agents/test/...` (extend an existing horton/worker registration test if present; otherwise create `packages/agents/test/comments-collection-registration.test.ts`)

- [ ] **Step 1: Write the failing test**

Check for an existing registration test: `ls packages/agents/test | grep -i "horton\|worker\|register"`. If one exercises the registry, extend it; otherwise create `packages/agents/test/comments-collection-registration.test.ts` that registers Horton into a fresh registry and asserts the definition declares a writable `comments` state collection:

```ts
import { describe, it, expect } from 'vitest'
import {
  createEntityRegistry,
  getEntityType,
} from '@electric-ax/agents-runtime'
import { registerHorton } from '../src/agents/horton'
// import the model catalog the existing tests use; mirror their setup.

describe(`comments collection registration`, () => {
  it(`declares comments as a writable state collection on horton`, () => {
    const registry = createEntityRegistry()
    registerHorton(registry, {
      workingDirectory: `/tmp`,
      modelCatalog:
        /* the test model catalog used elsewhere */ undefined as any,
    })
    const def = getEntityType(`horton`)?.definition as any
    expect(def.state?.comments?.writable).toEqual({
      principalColumn: `_principal`,
    })
  })
})
```

(Read an existing `packages/agents` test to copy the exact `modelCatalog` test fixture; do not invent one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @electric-ax/agents exec vitest run test/comments-collection-registration.test.ts`
Expected: FAIL — `def.state` is undefined.

- [ ] **Step 3: Add the state to Horton**

In `packages/agents/src/agents/horton.ts`, import the collection at the top: `import { commentsCollection } from '@electric-ax/agents-runtime'`. In the `registry.define('horton', { ... })` object (~line 759), add a `state` field:

```ts
    state: {
      comments: commentsCollection,
    },
```

- [ ] **Step 4: Add the state to worker**

In `packages/agents/src/agents/worker.ts`, import `commentsCollection` from `@electric-ax/agents-runtime` and add the same `state: { comments: commentsCollection }` to the `registry.define('worker', { ... })` object (line 303).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @electric-ax/agents exec vitest run test/comments-collection-registration.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents run typecheck`
Expected: PASS

```bash
git add packages/agents/src/agents/horton.ts packages/agents/src/agents/worker.ts packages/agents/test/comments-collection-registration.test.ts
git commit -m "feat(agents): declare comments as a writable state collection on horton and worker"
```

---

### Task C4: Project the comments collection into the timeline

**Files:**

- Modify: `packages/agents-runtime/src/entity-timeline.ts`
- Test: `packages/agents-runtime/test/entity-timeline.test.ts` (extend with the #4529 comment cases)
- Reference: `/tmp/pr4529.diff` (the `entity-timeline.ts` and `entity-timeline.test.ts` hunks)

- [ ] **Step 1: Port the #4529 timeline test cases**

From `/tmp/pr4529.diff`, copy the added cases in `entity-timeline.test.ts` into `packages/agents-runtime/test/entity-timeline.test.ts`, adapting them so the comment row's author is read from `_principal` (object `{url,kind,id}`) instead of `value.from_principal`. The assertions should check that comment rows appear interleaved by `_timeline_order` and expose the principal from `_principal`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @electric-ax/agents-runtime exec vitest run test/entity-timeline.test.ts`
Expected: FAIL — comments not projected into the timeline.

- [ ] **Step 3: Port the timeline projection**

From `/tmp/pr4529.diff`, port the `entity-timeline.ts` changes that project comment rows into the timeline row list. Two adaptations from #4529:

1. Source comment rows from the custom `comments` collection (`db.collections.comments`) rather than a built-in collection. (If the timeline iterates a fixed set of built-in collections, add `comments` to that set guarded by `db.collections.comments != null` so non-comment entities are unaffected.)
2. Read the author from the `_principal` virtual column (`row._principal?.url`) instead of `value.from_principal`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @electric-ax/agents-runtime exec vitest run test/entity-timeline.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-runtime run typecheck`
Expected: PASS

```bash
git add packages/agents-runtime/src/entity-timeline.ts packages/agents-runtime/test/entity-timeline.test.ts
git commit -m "feat(agents-runtime): project comments custom collection into timeline"
```

---

### Task C5: Clone the comments UI and re-source it

The #4529 UI is a verbatim clone; only the data source changes (generic collection + `_principal`, generic write action instead of `createComment`). The UI files (from the PR file list) are:

- `components/CommentBubble.tsx` + `.module.css`
- `components/EntityTimeline.tsx` + `.module.css`
- `components/MessageInput.tsx` + `.module.css`
- `components/AgentResponse.tsx`, `components/UserMessage.tsx` + css, `components/ToolCallView.tsx` + css, `components/toolBlock.module.css`, `components/InlineEventCard.tsx`
- `components/views/ChatView.tsx`
- `components/workspace/SplitMenu.tsx` + `.module.css`
- `hooks/useEntityTimeline.ts`
- `lib/comments.ts`
- `lib/workspace/registerViews.ts`
- Tests: `components/InlineEventCard.test.tsx`, `components/views/ChatView.test.ts`, `lib/comments.test.ts`

**Files:**

- Modify/Create: the files above under `packages/agents-server-ui/src/`
- Reference: `~/workspace/tmp-1/packages/agents-server-ui/src/` (exact files) and `/tmp/pr4529.diff`

- [ ] **Step 1: Diff each UI file against the clone**

For each file above, compare this repo's version with the clone to see exactly what #4529 added:

```bash
for f in components/CommentBubble.tsx components/CommentBubble.module.css components/EntityTimeline.tsx components/MessageInput.tsx lib/comments.ts hooks/useEntityTimeline.ts components/views/ChatView.tsx; do
  echo "=== $f ==="
  diff -u "packages/agents-server-ui/src/$f" "$HOME/workspace/tmp-1/packages/agents-server-ui/src/$f" 2>&1 | head -80
done
```

- [ ] **Step 2: Copy the net-new files verbatim**

Net-new files (no local version) can be copied directly from the clone:

```bash
cp ~/workspace/tmp-1/packages/agents-server-ui/src/components/CommentBubble.tsx packages/agents-server-ui/src/components/
cp ~/workspace/tmp-1/packages/agents-server-ui/src/components/CommentBubble.module.css packages/agents-server-ui/src/components/
cp ~/workspace/tmp-1/packages/agents-server-ui/src/lib/comments.ts packages/agents-server-ui/src/lib/
cp ~/workspace/tmp-1/packages/agents-server-ui/src/lib/comments.test.ts packages/agents-server-ui/src/lib/
```

(Confirm each has no pre-existing local version first with `ls`. For files that DO exist locally — `EntityTimeline.tsx`, `MessageInput.tsx`, `ChatView.tsx`, `useEntityTimeline.ts`, `AgentResponse.tsx`, `UserMessage.tsx`, `ToolCallView.tsx`, `InlineEventCard.tsx`, `SplitMenu.tsx`, `registerViews.ts`, and the `.module.css` siblings — apply the #4529 additions by hand using the diffs from Step 1, so local changes on this branch are preserved.)

- [ ] **Step 3: Re-source the write path onto the generic action**

In whichever module sends a comment (in #4529 this is the optimistic action that POSTs to `/comments`), change it to POST to `/collections/comments` with the generic body. Find it:

```bash
grep -rn "/comments\|createComment\|from_principal" packages/agents-server-ui/src
```

Replace the request with:

```ts
await fetch(`/_electric/entities/${type}/${instanceId}/collections/comments`, {
  method: `POST`,
  headers: { 'content-type': `application/json` },
  body: JSON.stringify({ operation: `insert`, key, value: commentValue }),
})
```

where `commentValue` carries `body`, optional `reply_to`, optional `target_snapshot`, and `timestamp` — but **not** `from_principal`. Prefer wiring through the auto-generated `comments_insert` TanStack action (`db.actions.comments_insert`) if the UI already builds the stream DB with the comments collection; fall back to a direct `fetch` only if the action is unavailable in that component.

- [ ] **Step 4: Re-source the read path onto `_principal`**

Anywhere the UI read `comment.from_principal` (alignment "is this me?", sender label), read `comment._principal?.url` instead. Find them:

```bash
grep -rn "from_principal" packages/agents-server-ui/src
```

Replace each with the `_principal.url` equivalent. The "right-align for current principal" check compares `comment._principal?.url === currentPrincipalUrl`.

- [ ] **Step 5: Run the UI tests**

Run: `pnpm --filter @electric-ax/agents-server-ui exec vitest run`
Expected: PASS — including the ported `comments.test.ts`, `InlineEventCard.test.tsx`, `ChatView.test.ts`. Fix any reference to `from_principal` in the test fixtures to use `_principal`.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @electric-ax/agents-server-ui run typecheck`
Expected: PASS

```bash
git add packages/agents-server-ui/src
git commit -m "feat(agents-server-ui): comments UI on generic writable collection"
```

---

### Task C6: Changeset + full verification

**Files:**

- Create: `.changeset/generic-writable-collections.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/generic-writable-collections.md`:

```markdown
---
'@electric-ax/agents-runtime': minor
'@electric-ax/agents-server': minor
'@electric-ax/agents-server-ui': minor
'@electric-ax/agents': minor
---

Add generic writable custom collections for agent entity state. Collections opt in
with a `writable` flag; router writes (`POST /:type/:id/collections/:collection`)
are authenticated, schema-validated, and stamp the principal into the change-event
header, which the client materializes into a virtual column. Comments are
re-implemented as one such collection.
```

- [ ] **Step 2: Run all four package test suites + typechecks**

```bash
pnpm --filter @electric-ax/agents-runtime run typecheck && pnpm --filter @electric-ax/agents-runtime exec vitest run
pnpm --filter @electric-ax/agents-server run typecheck && pnpm --filter @electric-ax/agents-server exec vitest run
pnpm --filter @electric-ax/agents run typecheck
pnpm --filter @electric-ax/agents-server-ui run typecheck && pnpm --filter @electric-ax/agents-server-ui exec vitest run
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add .changeset/generic-writable-collections.md
git commit -m "chore: changeset for generic writable collections"
```

---

## Self-review notes

- **Spec §1 (header API):** A2 (client virtual column) + B3 (server header stamping).
- **Spec §2 (writable safeguard):** A1 (type), A3 (registration emit), B1/B2 (server storage), B3 (403 enforcement).
- **Spec §3 (endpoint):** B4 (route + handler), B3 (manager). Single POST, operation in body, 201/200, 403 first.
- **Spec §4 (validation):** B3 reuses `validateWriteEvent`, validates `value` only, principal header excluded.
- **Spec §5 (client actions):** A2 + C5 (auto-generated `comments_insert` action / direct fetch fallback).
- **Spec §6 (comments consumer):** C1–C5.
- **Testing matrix (spec):** A2 (materialization, absent column), B3 (writable gating 403, principal stamping, value-only), B4 (route + principal), C3 (registration), C4 (timeline projection), C5 (UI tests).
