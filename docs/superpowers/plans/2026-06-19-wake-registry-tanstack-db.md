# Wake Registry TanStack DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `WakeRegistry`'s manual Postgres row cache and ShapeStream sync with TanStack DB collections, optimistic actions, `queryOnce`, and collection effects.

**Architecture:** `WakeRegistry` will own one TanStack DB collection of `wake_registrations` rows. Runtime uses `electricCollectionOptions` over the Postgres table; unit tests use a local-only collection. All mutations go through `createOptimisticAction`; each action persists to Postgres in its `mutationFn`, then awaits the Electric collection txid. Evaluation reads with `queryOnce`, and timeout wake timers are driven by `createEffect` over collection rows.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, Postgres, Electric `@electric-sql/client`, TanStack DB `@tanstack/db`, TanStack Electric collection `@tanstack/electric-db-collection`.

## Global Constraints

- Runtime requires Electric; there is no no-Electric Postgres fallback.
- No `wake_registrations` schema migration.
- No custom TanStack DB adapter.
- No pull-wake runner changes.
- No changes to persisted wake row payloads.
- All public `WakeRegistry` mutations invoke optimistic actions.
- Bulk unregister operations are one action per domain intent.
- Wake evaluation uses `queryOnce` over the collection.
- Timeout wake timers are driven by `createEffect` over collection rows.
- `WakeRegistry` must not instantiate `Shape` or `ShapeStream` directly.
- Before running package typecheck/tests in this worktree, run `pnpm install` from the repository root if workspace links are missing.

---

## File Structure

- `packages/agents-server/package.json`
  - Add runtime dependencies: `@tanstack/db` and `@tanstack/electric-db-collection`.
- `packages/agents-server/src/wake-registry.ts`
  - Main refactor. Owns TanStack DB collection, actions, query-based evaluation, and timeout effects.
- `packages/agents-server/src/entity-manager.ts`
  - Await async `wakeRegistry.evaluate(...)`, remove reload-on-miss fallback, and require `startSync(...)` for runtime startup.
- `packages/agents-server/src/host.ts`
  - Require `electricUrl` for host startup; remove `loadRegistrations()` fallback.
- `packages/agents-server/src/standalone-runtime.ts`
  - Keep passing Electric URL into `rebuildWakeRegistry(...)`; missing Electric URL should fail through `EntityManager.rebuildWakeRegistry(...)`.
- `packages/agents-server/test/wake-registry.test.ts`
  - Convert unit tests to local-only collection startup and async evaluation.
- `packages/agents-server/test/wake-registry-sync.test.ts`
  - Replace manual ShapeStream mock tests with Postgres + Electric collection integration tests or remove if covered elsewhere.
- `packages/agents-server/test/server-start.test.ts`
  - Update mocked `WakeRegistry` API and assert missing Electric URL fails when applicable.
- `.changeset/fix-deferred-pull-wakes.md`
  - Update if package dependencies/behavior summary changes.

---

### Task 1: Add TanStack DB Dependencies and Local Collection Foundation

**Files:**

- Modify: `packages/agents-server/package.json:46-67`
- Modify: `packages/agents-server/src/wake-registry.ts:1-180`
- Test: `packages/agents-server/test/wake-registry.test.ts:32-61`

**Interfaces:**

- Consumes: existing `WakeRegistration`, `WakeEvalResult`, `DrizzleDB`, `DEFAULT_TENANT_ID`.
- Produces:
  - `interface WakeRegistrationCollectionRow`
  - `WakeRegistry.startLocalForTests(): Promise<void>`
  - `WakeRegistry.evaluate(...): Promise<Array<WakeEvalResult>>`
  - `WakeRegistry.requireCollection(): Collection<WakeRegistrationCollectionRow, number>`

- [ ] **Step 1: Add dependencies**

Add these dependencies to `packages/agents-server/package.json` under `dependencies`:

```json
"@tanstack/db": "^0.6.7",
"@tanstack/electric-db-collection": "^0.3.5"
```

Run from repo root:

```bash
pnpm install
```

Expected: lockfile updates cleanly and package workspace links are materialized.

- [ ] **Step 2: Write failing local-collection evaluation test**

In `packages/agents-server/test/wake-registry.test.ts`, add this test near the first simple `Wake Registry` tests. This test intentionally uses a local collection helper that does not exist yet:

```ts
it(`evaluates registrations from local TanStack DB collection`, async () => {
  const registry = new WakeRegistry(createMockDb())
  await registry.startLocalForTests()

  await registry.register({
    subscriberUrl: `/parent/p1`,
    sourceUrl: `/child/c1`,
    condition: `runFinished`,
    oneShot: false,
  })

  const results = await registry.evaluate(`/child/c1`, {
    type: `run`,
    key: `run-1`,
    value: { status: `completed` },
    headers: { operation: `update` },
  })

  expect(results).toHaveLength(1)
  expect(results[0]!.subscriberUrl).toBe(`/parent/p1`)
  expect(results[0]!.registrationDbId).toBe(1)
  expect(results[0]!.sourceEventKey).toBe(`update:run-1`)
})
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts -t "evaluates registrations from local TanStack DB collection" --run
```

Expected: FAIL with TypeScript/runtime error that `startLocalForTests` does not exist or `evaluate` is not awaitable yet.

- [ ] **Step 4: Add collection foundation alongside the legacy runtime cache**

Task 1 is an incremental local-only foundation. Keep the existing `registrationCache`, `ShapeStream`, `startSync(...)`, and runtime cache code in place until Task 4 removes them. In `packages/agents-server/src/wake-registry.ts`, add TanStack DB imports at the top while keeping imports that are still needed by the legacy runtime path:

```ts
import {
  and as dbAnd,
  createCollection,
  createOptimisticAction,
  eq as dbEq,
  localOnlyCollectionOptions,
  queryOnce,
} from '@tanstack/db'
import { and, eq } from 'drizzle-orm'
import { wakeRegistrations } from './db/schema.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import type { Collection } from '@tanstack/db'
import type { DrizzleDB } from './db/index.js'
```

Do not remove the existing `ShapeStream`, `serverLog`, `electricUrlWithPath`, `Row`, or `Value` imports in Task 1 if they are still used by the legacy runtime path. Task 4 removes manual ShapeStream runtime sync.

Add this row type and local test state after `WakeDebounceCallback`:

```ts
interface WakeRegistrationCollectionRow {
  id: number
  tenantId: string
  subscriberUrl: string
  sourceUrl: string
  condition: WakeRegistration[`condition`]
  debounceMs: number
  timeoutMs: number
  oneShot: boolean
  timeoutConsumed: boolean
  includeResponse: boolean
  manifestKey: string | null
  createdAt: Date
}

type WakeRegistryMode = `unstarted` | `local-test` | `electric`
```

In `WakeRegistry`, add these fields next to the existing legacy cache/sync fields. Do not remove the old cache fields in Task 1 because the existing runtime `startSync(...)` path still uses them until Task 4.

```ts
private registrationsCollection: Collection<WakeRegistrationCollectionRow, number> | null = null
private mode: WakeRegistryMode = `unstarted`
private nextLocalId = 1
```

Add these helpers inside `WakeRegistry`:

```ts
private requireCollection(): Collection<WakeRegistrationCollectionRow, number> {
  if (!this.registrationsCollection) {
    throw new Error(`WakeRegistry has not been started`)
  }
  return this.registrationsCollection
}

async startLocalForTests(): Promise<void> {
  if (this.registrationsCollection) return
  this.mode = `local-test`
  this.registrationsCollection = createCollection(
    localOnlyCollectionOptions<WakeRegistrationCollectionRow>({
      id: `wake-registrations-local:${this.tenantId ?? `all`}`,
      getKey: (row) => row.id,
      initialData: [],
    })
  )
  await this.registrationsCollection.preload()
}

private allocateLocalId(): number {
  return this.nextLocalId++
}

private normalizeRegistration(
  reg: WakeRegistration,
  tenantId: string,
  id: number
): WakeRegistrationCollectionRow {
  return {
    id,
    tenantId,
    subscriberUrl: reg.subscriberUrl,
    sourceUrl: reg.sourceUrl,
    condition: reg.condition,
    debounceMs: reg.debounceMs ?? 0,
    timeoutMs: reg.timeoutMs ?? 0,
    oneShot: reg.oneShot,
    timeoutConsumed: false,
    includeResponse: reg.includeResponse !== false,
    manifestKey: reg.manifestKey ?? null,
    createdAt: new Date(),
  }
}
```

- [ ] **Step 5: Implement local register action and async queryOnce evaluation**

Add this action field and initializer inside `WakeRegistry`. The local action is enough for this task; runtime persistence is added later.

```ts
private registerAction = createOptimisticAction<WakeRegistrationCollectionRow>({
  onMutate: (row) => {
    this.requireCollection().insert(row)
  },
  mutationFn: async () => {
    if (this.mode === `local-test`) return
    throw new Error(`WakeRegistry registerAction runtime persistence is not initialized`)
  },
})
```

Replace `register(reg: WakeRegistration): Promise<void>` with this minimal local implementation:

```ts
async register(reg: WakeRegistration): Promise<void> {
  const tenantId = this.resolveTenantId(reg.tenantId)
  const id = this.mode === `local-test` ? this.allocateLocalId() : this.allocateLocalId()
  const tx = this.registerAction(this.normalizeRegistration(reg, tenantId, id))
  await tx.isPersisted.promise
}
```

Replace the start of `evaluate(...)` with an async collection query. Keep the existing matching/debounce/result code, but iterate over `regs` from `queryOnce` instead of the old `registrationCache` array:

```ts
async evaluate(
  sourceUrl: string,
  event: Record<string, unknown>,
  tenantId?: string
): Promise<Array<WakeEvalResult>> {
  const resolvedTenantId = this.resolveTenantId(tenantId)
  const regs = await queryOnce((q) =>
    q
      .from({ reg: this.requireCollection() })
      .where(({ reg }) =>
        dbAnd(dbEq(reg.tenantId, resolvedTenantId), dbEq(reg.sourceUrl, sourceUrl))
      )
  )
  if (regs.length === 0) return []

  const results: Array<WakeEvalResult> = []
  const oneShotRows: Array<WakeRegistrationCollectionRow> = []

  for (const reg of regs) {
    const match = this.matchCondition(reg, event)
    if (!match) continue

    const timerKey = this.registrationKey(reg)
    const timeoutTimer = this.timeoutTimers.get(timerKey)
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      this.timeoutTimers.delete(timerKey)
      void this.markTimeoutConsumed(reg.id, reg.tenantId)
    }

    if (reg.debounceMs > 0) {
      const buffer = this.debounceBuffers.get(timerKey) ?? []
      buffer.push(match.change)
      this.debounceBuffers.set(timerKey, buffer)
      if (match.runFinishedStatus) {
        this.debounceRunStatus.set(timerKey, match.runFinishedStatus)
      }
      const existing = this.debounceTimers.get(timerKey)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        this.debounceTimers.delete(timerKey)
        const flushed = this.debounceBuffers.get(timerKey)
        if (flushed && flushed.length > 0) {
          this.debounceBuffers.delete(timerKey)
          const runStatus = this.debounceRunStatus.get(timerKey)
          this.debounceRunStatus.delete(timerKey)
          this.deliverDebounce({
            tenantId: reg.tenantId,
            subscriberUrl: reg.subscriberUrl,
            registrationDbId: reg.id,
            sourceEventKey: flushed[flushed.length - 1]!.key,
            wakeMessage: {
              source: sourceUrl,
              timeout: false,
              changes: flushed,
            },
            runFinishedStatus: runStatus,
            includeResponse: reg.includeResponse,
          })
        }
      }, reg.debounceMs)
      this.debounceTimers.set(timerKey, timer)
    } else {
      results.push({
        tenantId: reg.tenantId,
        subscriberUrl: reg.subscriberUrl,
        registrationDbId: reg.id,
        sourceEventKey: wakeSourceEventId(event),
        wakeMessage: {
          source: sourceUrl,
          timeout: false,
          changes: [match.change],
        },
        runFinishedStatus: match.runFinishedStatus,
        includeResponse: reg.includeResponse,
      })
    }

    if (reg.oneShot) oneShotRows.push(reg)
  }

  for (const reg of oneShotRows) {
    this.clearRegistrationState(reg)
    this.timeoutDelivered.delete(reg.id)
    this.requireCollection().delete(reg.id)
  }

  return results
}
```

Update `registrationKey`, `clearRegistrationState`, `matchCondition`, and timeout helper parameter types from `CachedWakeRegistration` to `WakeRegistrationCollectionRow` where needed:

```ts
private registrationKey(reg: WakeRegistrationCollectionRow): string
private clearRegistrationState(reg: WakeRegistrationCollectionRow): void
private matchCondition(reg: WakeRegistrationCollectionRow, event: Record<string, unknown>): ...
```

- [ ] **Step 6: Run the focused test to verify it passes**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts -t "evaluates registrations from local TanStack DB collection" --run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agents-server/package.json pnpm-lock.yaml packages/agents-server/src/wake-registry.ts packages/agents-server/test/wake-registry.test.ts
git commit -m "Introduce TanStack DB wake registry collection"
```

---

### Task 2: Convert All Unit-Test Registry Mutations to Optimistic Actions

**Files:**

- Modify: `packages/agents-server/src/wake-registry.ts:298-530, 730-910`
- Modify: `packages/agents-server/test/wake-registry.test.ts`

**Interfaces:**

- Consumes: `WakeRegistrationCollectionRow`, `WakeRegistry.requireCollection()`, async `WakeRegistry.evaluate(...)`.
- Produces:
  - `unregisterByManifestKeyAction`
  - `unregisterBySubscriberAction`
  - `unregisterBySourceAction`
  - `unregisterBySubscriberAndSourceAction`
  - `markTimeoutConsumedAction`
  - `consumeMatchedRegistrationsAction`

- [ ] **Step 1: Write failing tests for bulk unregister actions**

Add these tests to `packages/agents-server/test/wake-registry.test.ts` near existing unregister tests:

```ts
it(`unregisterBySource removes all matching local collection rows`, async () => {
  const registry = new WakeRegistry(createMockDb())
  await registry.startLocalForTests()

  await registry.register({
    subscriberUrl: `/parent/a`,
    sourceUrl: `/source/1`,
    condition: { on: `change` },
    oneShot: false,
  })
  await registry.register({
    subscriberUrl: `/parent/b`,
    sourceUrl: `/source/1`,
    condition: { on: `change` },
    oneShot: false,
  })
  await registry.register({
    subscriberUrl: `/parent/c`,
    sourceUrl: `/source/2`,
    condition: { on: `change` },
    oneShot: false,
  })

  await registry.unregisterBySource(`/source/1`)

  expect(
    await registry.evaluate(`/source/1`, {
      type: `texts`,
      key: `t1`,
      value: {},
      headers: { operation: `insert` },
    })
  ).toHaveLength(0)
  expect(
    await registry.evaluate(`/source/2`, {
      type: `texts`,
      key: `t2`,
      value: {},
      headers: { operation: `insert` },
    })
  ).toHaveLength(1)
})

it(`oneShot match removes row before a second immediate evaluation`, async () => {
  const registry = new WakeRegistry(createMockDb())
  await registry.startLocalForTests()

  await registry.register({
    subscriberUrl: `/parent/p1`,
    sourceUrl: `/child/c1`,
    condition: `runFinished`,
    oneShot: true,
  })

  const event = {
    type: `run`,
    key: `run-1`,
    value: { status: `completed` },
    headers: { operation: `update` },
  }

  expect(await registry.evaluate(`/child/c1`, event)).toHaveLength(1)
  expect(await registry.evaluate(`/child/c1`, event)).toHaveLength(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts -t "unregisterBySource removes|oneShot match removes" --run
```

Expected: FAIL if unregisters or one-shot cleanup still use old cache/DB paths.

- [ ] **Step 3: Add query helpers for matching rows**

Add these helpers to `WakeRegistry`:

```ts
private async rowsByPredicate(
  predicate: (row: WakeRegistrationCollectionRow) => boolean
): Promise<Array<WakeRegistrationCollectionRow>> {
  const rows = await queryOnce((q) => q.from({ reg: this.requireCollection() }))
  return rows.filter(predicate)
}

private async rowsForSource(
  tenantId: string,
  sourceUrl: string
): Promise<Array<WakeRegistrationCollectionRow>> {
  return await queryOnce((q) =>
    q
      .from({ reg: this.requireCollection() })
      .where(({ reg }) =>
        dbAnd(dbEq(reg.tenantId, tenantId), dbEq(reg.sourceUrl, sourceUrl))
      )
  )
}
```

This task may use `rowsByPredicate` for local actions because action `onMutate` must be synchronous. Capture the rows before invoking the action and pass their ids into the action input.

- [ ] **Step 4: Implement unregister optimistic actions**

Add action input types near `WakeRegistryMode`:

```ts
type DeleteRowsInput = {
  rows: Array<WakeRegistrationCollectionRow>
  persist:
    | {
        kind: `manifestKey`
        tenantId: string
        subscriberUrl: string
        manifestKey: string
      }
    | {
        kind: `subscriber`
        tenantId: string
        subscriberUrl: string
      }
    | {
        kind: `source`
        tenantId: string
        sourceUrl: string
      }
    | {
        kind: `subscriberAndSource`
        tenantId: string
        subscriberUrl: string
        sourceUrl: string
      }
    | {
        kind: `oneShot`
      }
}
```

Add one shared delete action:

```ts
private deleteRowsAction = createOptimisticAction<DeleteRowsInput>({
  onMutate: ({ rows }) => {
    const collection = this.requireCollection()
    for (const row of rows) {
      this.clearRegistrationState(row)
      this.timeoutDelivered.delete(row.id)
      collection.delete(row.id)
    }
  },
  mutationFn: async ({ persist }) => {
    if (this.mode === `local-test` || persist.kind === `oneShot`) return
    throw new Error(`WakeRegistry deleteRowsAction runtime persistence is not initialized`)
  },
})
```

Replace unregister methods with wrappers that query rows, invoke the action, and await persistence:

```ts
async unregisterBySource(sourceUrl: string, tenantId?: string): Promise<void> {
  const resolvedTenantId = this.resolveTenantId(tenantId)
  const rows = await this.rowsForSource(resolvedTenantId, sourceUrl)
  const tx = this.deleteRowsAction({
    rows,
    persist: { kind: `source`, tenantId: resolvedTenantId, sourceUrl },
  })
  await tx.isPersisted.promise
}
```

Implement the other three unregister methods with the same pattern:

```ts
async unregisterBySubscriber(subscriberUrl: string, tenantId?: string): Promise<void> {
  const resolvedTenantId = this.resolveTenantId(tenantId)
  const rows = await this.rowsByPredicate(
    (row) => row.tenantId === resolvedTenantId && row.subscriberUrl === subscriberUrl
  )
  const tx = this.deleteRowsAction({
    rows,
    persist: { kind: `subscriber`, tenantId: resolvedTenantId, subscriberUrl },
  })
  await tx.isPersisted.promise
}

async unregisterByManifestKey(
  subscriberUrl: string,
  manifestKey: string,
  tenantId?: string
): Promise<void> {
  const resolvedTenantId = this.resolveTenantId(tenantId)
  const rows = await this.rowsByPredicate(
    (row) =>
      row.tenantId === resolvedTenantId &&
      row.subscriberUrl === subscriberUrl &&
      row.manifestKey === manifestKey
  )
  const tx = this.deleteRowsAction({
    rows,
    persist: { kind: `manifestKey`, tenantId: resolvedTenantId, subscriberUrl, manifestKey },
  })
  await tx.isPersisted.promise
}

async unregisterBySubscriberAndSource(
  subscriberUrl: string,
  sourceUrl: string,
  tenantId?: string
): Promise<void> {
  const resolvedTenantId = this.resolveTenantId(tenantId)
  const rows = await this.rowsByPredicate(
    (row) =>
      row.tenantId === resolvedTenantId &&
      row.subscriberUrl === subscriberUrl &&
      row.sourceUrl === sourceUrl
  )
  const tx = this.deleteRowsAction({
    rows,
    persist: { kind: `subscriberAndSource`, tenantId: resolvedTenantId, subscriberUrl, sourceUrl },
  })
  await tx.isPersisted.promise
}
```

- [ ] **Step 5: Implement mark-timeout-consumed action**

Add this action:

```ts
private markTimeoutConsumedAction = createOptimisticAction<{
  row: WakeRegistrationCollectionRow
}>({
  onMutate: ({ row }) => {
    this.requireCollection().update(row.id, (draft) => {
      draft.timeoutConsumed = true
    })
  },
  mutationFn: async () => {
    if (this.mode === `local-test`) return
    throw new Error(`WakeRegistry markTimeoutConsumedAction runtime persistence is not initialized`)
  },
})
```

Replace `markTimeoutConsumed(dbId, tenantId)` with:

```ts
private async markTimeoutConsumed(dbId: number, tenantId: string): Promise<void> {
  const row = await queryOnce((q) =>
    q
      .from({ reg: this.requireCollection() })
      .where(({ reg }) => dbAnd(dbEq(reg.tenantId, tenantId), dbEq(reg.id, dbId)))
      .findOne()
  )
  if (!row) return
  const tx = this.markTimeoutConsumedAction({ row })
  await tx.isPersisted.promise
}
```

- [ ] **Step 6: Route one-shot cleanup through the shared action**

In `evaluate(...)`, replace direct `collection.delete(...)` one-shot cleanup with:

```ts
if (oneShotRows.length > 0) {
  const tx = this.deleteRowsAction({
    rows: oneShotRows,
    persist: { kind: `oneShot` },
  })
  void tx.isPersisted.promise.catch((error) => {
    console.warn(`[wake-registry] failed to persist one-shot cleanup:`, error)
  })
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts -t "unregisterBySource removes|oneShot match removes|evaluates registrations from local" --run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/agents-server/src/wake-registry.ts packages/agents-server/test/wake-registry.test.ts
git commit -m "Move wake registry mutations to optimistic actions"
```

---

### Task 3: Drive Timeout Wakes with TanStack DB Effects

**Files:**

- Modify: `packages/agents-server/src/wake-registry.ts:104-177, 562-728`
- Modify: `packages/agents-server/test/wake-registry.test.ts`

**Interfaces:**

- Consumes: `WakeRegistrationCollectionRow`, local collection startup, optimistic timeout action.
- Produces:
  - `private registrationsEffect: { dispose(): Promise<void> } | null`
  - `private startRegistrationEffect(): void`
  - timeout timers synchronized from collection rows via `createEffect`

- [ ] **Step 1: Write failing timeout effect tests**

Add this test near existing timeout tests:

```ts
it(`timeout effect delivers timeout wake once and marks row consumed`, async () => {
  const registry = new WakeRegistry(createMockDb())
  await registry.startLocalForTests()
  const delivered: Array<WakeEvalResult> = []
  registry.setTimeoutCallback((result) => delivered.push(result))

  await registry.register({
    subscriberUrl: `/parent/p1`,
    sourceUrl: `/child/c1`,
    condition: `runFinished`,
    oneShot: false,
    timeoutMs: 25,
  })

  await new Promise((resolve) => setTimeout(resolve, 80))

  expect(delivered).toHaveLength(1)
  expect(delivered[0]!.wakeMessage.timeout).toBe(true)

  await new Promise((resolve) => setTimeout(resolve, 80))
  expect(delivered).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts -t "timeout effect delivers" --run
```

Expected: FAIL until the collection effect starts timers from row enter/update events.

- [ ] **Step 3: Import `createEffect` and add effect field**

Update imports from `@tanstack/db`:

```ts
import {
  and as dbAnd,
  createCollection,
  createEffect,
  createOptimisticAction,
  eq as dbEq,
  localOnlyCollectionOptions,
  queryOnce,
} from '@tanstack/db'
```

Add field:

```ts
private registrationsEffect: { dispose(): Promise<void> } | null = null
```

- [ ] **Step 4: Start the effect after collection preload**

Add this method:

```ts
private startRegistrationEffect(): void {
  if (this.registrationsEffect) return
  const collection = this.requireCollection()
  this.registrationsEffect = createEffect({
    query: (q) => q.from({ reg: collection }),
    skipInitial: false,
    onEnter: ({ value }) => {
      this.syncTimeoutTimer(value)
    },
    onUpdate: ({ value }) => {
      this.syncTimeoutTimer(value)
    },
    onExit: ({ value }) => {
      this.clearRegistrationState(value)
      this.timeoutDelivered.delete(value.id)
    },
  })
}
```

Call it at the end of `startLocalForTests()` after `await this.registrationsCollection.preload()`:

```ts
this.startRegistrationEffect()
```

- [ ] **Step 5: Update timeout helpers to collection row type**

Replace old timeout helper signatures with:

```ts
private startTimeoutTimer(reg: WakeRegistrationCollectionRow): void
private startTimeoutTimerWithDuration(reg: WakeRegistrationCollectionRow, durationMs: number): void
private syncTimeoutTimer(reg: WakeRegistrationCollectionRow): void
private deliverTimeoutForRegistration(reg: WakeRegistrationCollectionRow): void
private timeoutWakeResult(reg: WakeRegistrationCollectionRow): WakeEvalResult
```

Use `reg.id` instead of `dbId` inside these helpers. The key bodies should be:

```ts
private startTimeoutTimer(reg: WakeRegistrationCollectionRow): void {
  if (reg.timeoutMs <= 0) return
  this.startTimeoutTimerWithDuration(reg, reg.timeoutMs)
}

private startTimeoutTimerWithDuration(
  reg: WakeRegistrationCollectionRow,
  durationMs: number
): void {
  const timerKey = this.registrationKey(reg)
  const timer = setTimeout(() => {
    this.timeoutTimers.delete(timerKey)
    this.deliverTimeoutForRegistration(reg)
  }, durationMs)
  this.timeoutTimers.set(timerKey, timer)
}

private syncTimeoutTimer(reg: WakeRegistrationCollectionRow): void {
  const timerKey = this.registrationKey(reg)

  if (reg.timeoutConsumed || reg.timeoutMs <= 0) {
    this.clearTimeoutState(timerKey)
    return
  }

  if (this.timeoutTimers.has(timerKey)) return

  const remaining = reg.createdAt.getTime() + reg.timeoutMs - Date.now()
  if (remaining > 0) {
    this.startTimeoutTimerWithDuration(reg, remaining)
    return
  }

  if (this.timeoutDelivered.has(reg.id)) return
  this.deliverTimeoutForRegistration(reg)
}

private deliverTimeoutForRegistration(reg: WakeRegistrationCollectionRow): void {
  if (this.deliverTimeout(this.timeoutWakeResult(reg))) {
    this.timeoutDelivered.add(reg.id)
    void this.markTimeoutConsumed(reg.id, reg.tenantId).catch((error) => {
      console.warn(`[wake-registry] failed to mark timeout consumed:`, error)
    })
  }
}

private timeoutWakeResult(reg: WakeRegistrationCollectionRow): WakeEvalResult {
  return {
    tenantId: reg.tenantId,
    subscriberUrl: reg.subscriberUrl,
    registrationDbId: reg.id,
    sourceEventKey: `timeout`,
    wakeMessage: {
      source: reg.sourceUrl,
      timeout: true,
      changes: [],
    },
  }
}
```

- [ ] **Step 6: Stop effect and clear timers on shutdown**

Replace `stopSync()` with a general cleanup that still keeps the public method name for current call sites:

```ts
async stopSync(): Promise<void> {
  await this.registrationsEffect?.dispose()
  this.registrationsEffect = null
  this.registrationsCollection = null
  this.mode = `unstarted`
  this.resetRuntimeState()
}

private resetRuntimeState(): void {
  for (const timer of this.debounceTimers.values()) clearTimeout(timer)
  this.debounceTimers.clear()
  this.debounceBuffers.clear()
  this.debounceRunStatus.clear()
  for (const timer of this.timeoutTimers.values()) clearTimeout(timer)
  this.timeoutTimers.clear()
  this.timeoutDelivered.clear()
}
```

- [ ] **Step 7: Run timeout tests**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts -t "timeout" --run
```

Expected: timeout tests PASS or fail only where assertions still assume old synchronous cache behavior.

- [ ] **Step 8: Commit**

```bash
git add packages/agents-server/src/wake-registry.ts packages/agents-server/test/wake-registry.test.ts
git commit -m "Drive wake timeouts from registry collection effects"
```

---

### Task 4: Implement Runtime Electric Collection and Postgres Txid Mutation Handlers

**Files:**

- Modify: `packages/agents-server/src/wake-registry.ts:1-360`
- Test: `packages/agents-server/test/wake-registry-sync.test.ts`

**Interfaces:**

- Consumes: local collection/action architecture from Tasks 1-3.
- Produces:
  - Runtime `WakeRegistry.startSync(electricUrl, electricSecret?)`
  - Electric collection with `snakeCamelMapper()`
  - runtime `registerAction`, `deleteRowsAction`, `markTimeoutConsumedAction` persistence
  - no direct `Shape` or `ShapeStream` usage in `WakeRegistry`

- [ ] **Step 1: Write failing integration test for Electric-backed registry sync**

Replace `packages/agents-server/test/wake-registry-sync.test.ts` with this integration test skeleton. It uses the existing managed test backend.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db'
import { wakeRegistrations } from '../src/db/schema'
import { WakeRegistry } from '../src/wake-registry'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

const db = createDb(TEST_POSTGRES_URL)

describe(`WakeRegistry Electric collection sync`, () => {
  beforeAll(async () => {
    await resetElectricAgentsTestBackend()
  })

  afterAll(async () => {
    await db.end?.()
  })

  it(`syncs a registered wake through Postgres and Electric`, async () => {
    const registry = new WakeRegistry(db as any)
    await registry.startSync(TEST_ELECTRIC_URL)

    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })

    const rows = await db
      .select()
      .from(wakeRegistrations)
      .where(eq(wakeRegistrations.sourceUrl, `/child/c1`))

    expect(rows).toHaveLength(1)

    const results = await registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.registrationDbId).toBe(rows[0]!.id)

    await registry.stopSync()
  })
})
```

If `createDb(TEST_POSTGRES_URL)` does not expose `end`, remove the `afterAll` block and follow the existing DB helper pattern in nearby integration tests.

- [ ] **Step 2: Run integration test to verify it fails**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry-sync.test.ts --run
```

Expected: FAIL because `startSync` still uses manual ShapeStream or runtime actions do not persist and await Electric txids yet.

- [ ] **Step 3: Import Electric collection and column mapper**

Update imports in `wake-registry.ts`:

```ts
import { snakeCamelMapper } from '@electric-sql/client'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { sql } from 'drizzle-orm'
import { electricUrlWithPath } from './utils/electric-url.js'
import { serverLog } from './utils/log.js'
```

Keep Drizzle `and`/`eq` imports for mutation predicates:

```ts
import { and, eq, sql } from 'drizzle-orm'
```

- [ ] **Step 4: Implement sequence id allocation and txid helper**

Add these helpers to `WakeRegistry`:

```ts
private async allocateRuntimeId(): Promise<number> {
  const rows = await this.db.execute(sql<{ id: string }>`select nextval('wake_registrations_id_seq')::text as id`)
  const value = Array.isArray(rows) ? rows[0]?.id : (rows as any)[0]?.id
  const id = Number(value)
  if (!Number.isInteger(id)) {
    throw new Error(`Failed to allocate wake registration id`)
  }
  return id
}

private async currentTxid(): Promise<number> {
  const rows = await this.db.execute(sql<{ txid: string }>`select pg_current_xact_id()::xid::text as txid`)
  const value = Array.isArray(rows) ? rows[0]?.txid : (rows as any)[0]?.txid
  const txid = Number(value)
  if (!Number.isInteger(txid)) {
    throw new Error(`Failed to read Postgres transaction id`)
  }
  return txid
}
```

If `DrizzleDB.execute(...)` returns `{ rows }` rather than an array in this codebase, adapt the extraction to:

```ts
const result = await this.db.execute(...)
const value = result.rows[0]?.txid
```

Use the actual shape observed by TypeScript/tests; keep the method returning `number`.

- [ ] **Step 5: Implement Electric `startSync`**

Replace old `startSync(...)` with an Electric collection that syncs rows but does not persist writes itself. Persistence belongs to the optimistic action `mutationFn` methods in later steps.

```ts
async startSync(electricUrl: string, electricSecret?: string): Promise<void> {
  if (this.registrationsCollection) {
    await this.registrationsCollection.preload()
    return
  }

  this.mode = `electric`
  this.registrationsCollection = createCollection(
    electricCollectionOptions<WakeRegistrationCollectionRow>({
      id: `wake-registrations:${this.tenantId ?? `all`}`,
      getKey: (row) => row.id,
      shapeOptions: {
        url: electricUrlWithPath(electricUrl, `/v1/shape`).toString(),
        params: {
          table: `wake_registrations`,
          ...(this.tenantId
            ? { where: `tenant_id = ${sqlStringLiteral(this.tenantId)}` }
            : {}),
          ...(electricSecret ? { secret: electricSecret } : {}),
          columns: [
            `id`,
            `tenant_id`,
            `subscriber_url`,
            `source_url`,
            `condition`,
            `debounce_ms`,
            `timeout_ms`,
            `one_shot`,
            `timeout_consumed`,
            `include_response`,
            `manifest_key`,
            `created_at`,
          ],
          replica: `full`,
        },
        parser: {
          timestamptz: (value: string) => new Date(value),
        },
        columnMapper: snakeCamelMapper(),
      },
    })
  )

  await this.registrationsCollection.preload()
  this.startRegistrationEffect()
}
```

- [ ] **Step 6: Implement runtime persistence helpers**

Add these helpers:

```ts
private async persistInsert(row: WakeRegistrationCollectionRow): Promise<number> {
  const result = await this.db.transaction(async (tx) => {
    await tx
      .insert(wakeRegistrations)
      .values({
        id: row.id,
        tenantId: row.tenantId,
        subscriberUrl: row.subscriberUrl,
        sourceUrl: row.sourceUrl,
        condition: row.condition,
        debounceMs: row.debounceMs,
        timeoutMs: row.timeoutMs,
        oneShot: row.oneShot,
        timeoutConsumed: row.timeoutConsumed,
        includeResponse: row.includeResponse,
        manifestKey: row.manifestKey,
        createdAt: row.createdAt,
      })
      .onConflictDoNothing()
    const rows = await tx.execute(sql<{ txid: string }>`select pg_current_xact_id()::xid::text as txid`)
    return Number(Array.isArray(rows) ? rows[0]!.txid : (rows as any)[0]!.txid)
  })
  return result
}

private async persistTimeoutConsumed(row: WakeRegistrationCollectionRow): Promise<number> {
  return await this.db.transaction(async (tx) => {
    await tx
      .update(wakeRegistrations)
      .set({ timeoutConsumed: row.timeoutConsumed })
      .where(and(eq(wakeRegistrations.tenantId, row.tenantId), eq(wakeRegistrations.id, row.id)))
    const rows = await tx.execute(sql<{ txid: string }>`select pg_current_xact_id()::xid::text as txid`)
    return Number(Array.isArray(rows) ? rows[0]!.txid : (rows as any)[0]!.txid)
  })
}

private async persistDeleteRows(rows: Array<WakeRegistrationCollectionRow>): Promise<number> {
  return await this.db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .delete(wakeRegistrations)
        .where(and(eq(wakeRegistrations.tenantId, row.tenantId), eq(wakeRegistrations.id, row.id)))
    }
    const txRows = await tx.execute(sql<{ txid: string }>`select pg_current_xact_id()::xid::text as txid`)
    return Number(Array.isArray(txRows) ? txRows[0]!.txid : (txRows as any)[0]!.txid)
  })
}
```

If Drizzle's transaction type does not accept `.execute` in this form, follow the pattern already used in `packages/agents-server/src/entity-registry.ts` for `pg_current_xact_id()::xid::text`.

- [ ] **Step 7: Wire runtime actions to persistence**

Update `register(...)` to allocate runtime ids from Postgres:

```ts
async register(reg: WakeRegistration): Promise<void> {
  const tenantId = this.resolveTenantId(reg.tenantId)
  const id = this.mode === `electric` ? await this.allocateRuntimeId() : this.allocateLocalId()
  const tx = this.registerAction(this.normalizeRegistration(reg, tenantId, id))
  await tx.isPersisted.promise
}
```

Update `registerAction.mutationFn` so the action persists once, then waits for Electric to sync that txid into the collection:

```ts
mutationFn: async (row) => {
  if (this.mode === `local-test`) return
  if (this.mode === `electric`) {
    const txid = await this.persistInsert(row)
    await this.requireCollection().utils.awaitTxId(txid, 10_000)
    return { txid }
  }
  throw new Error(`WakeRegistry registerAction called before startup`)
}
```

Update `deleteRowsAction.mutationFn`:

```ts
mutationFn: async ({ rows }) => {
  if (this.mode === `local-test`) return
  if (this.mode === `electric`) {
    const txid = await this.persistDeleteRows(rows)
    await this.requireCollection().utils.awaitTxId(txid, 10_000)
    return { txid }
  }
  throw new Error(`WakeRegistry deleteRowsAction called before startup`)
}
```

Update `markTimeoutConsumedAction.mutationFn`:

```ts
mutationFn: async ({ row }) => {
  if (this.mode === `local-test`) return
  if (this.mode === `electric`) {
    const txid = await this.persistTimeoutConsumed({
      ...row,
      timeoutConsumed: true,
    })
    await this.requireCollection().utils.awaitTxId(txid, 10_000)
    return { txid }
  }
  throw new Error(
    `WakeRegistry markTimeoutConsumedAction called before startup`
  )
}
```

- [ ] **Step 8: Remove manual Shape code**

Delete these obsolete items from `wake-registry.ts`:

```ts
interface WakeRegistrationShapeRow ...
normalizeShapeRow(...)
shapeRowMatchesRegistration(...)
waitForRegistrationInShape(...)
recoverSync(...)
loadRegistrations(...)
replaceCachedRegistrations(...)
upsertCachedRegistration(...)
removeCachedRegistrationByDbId(...)
findCachedRegistration(...)
resetCachedRegistrations(...)
```

Also remove all direct imports/usages of `Shape`, `ShapeStream`, `Row`, and `Value`.

- [ ] **Step 9: Run sync integration test**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry-sync.test.ts --run
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/agents-server/src/wake-registry.ts packages/agents-server/test/wake-registry-sync.test.ts
git commit -m "Use Electric collection for wake registrations"
```

---

### Task 5: Update EntityManager, Host Startup, and Async Evaluation Call Sites

**Files:**

- Modify: `packages/agents-server/src/entity-manager.ts:430-440, 3291-3310`
- Modify: `packages/agents-server/src/host.ts:111-120`
- Modify: `packages/agents-server/src/standalone-runtime.ts:151-157`
- Modify: `packages/agents-server/test/server-start.test.ts`
- Modify: `packages/agents-server/test/wake-registry.test.ts`

**Interfaces:**

- Consumes: async `WakeRegistry.evaluate(...)`, `WakeRegistry.startSync(...)`, removed `loadRegistrations()`.
- Produces: runtime startup fails without Electric URL, no reload-on-miss fallback, all tests await evaluation.

- [ ] **Step 1: Write failing startup test for missing Electric URL**

In `packages/agents-server/test/server-start.test.ts`, update or add a test with this assertion:

```ts
it(`fails host startup without Electric URL for wake registry sync`, async () => {
  const host = createTestHost({ electricUrl: undefined })

  await expect(host.start()).rejects.toThrow(
    `WakeRegistry runtime requires an Electric URL`
  )
})
```

If `createTestHost` does not exist, follow the existing host construction helper in this file and assert the same error around `host.start()`.

- [ ] **Step 2: Run startup test to verify it fails**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/server-start.test.ts -t "fails host startup without Electric URL" --run
```

Expected: FAIL because host still calls `loadRegistrations()` or the test helper needs updating.

- [ ] **Step 3: Update `EntityManager.rebuildWakeRegistry`**

Replace `rebuildWakeRegistry(...)` in `packages/agents-server/src/entity-manager.ts` with:

```ts
async rebuildWakeRegistry(
  electricUrl?: string,
  electricSecret?: string
): Promise<void> {
  if (!electricUrl) {
    throw new Error(`WakeRegistry runtime requires an Electric URL`)
  }
  await this.wakeRegistry.startSync(electricUrl, electricSecret)
}
```

- [ ] **Step 4: Await async registry evaluation and remove reload-on-miss workaround**

In `evaluateWakes(...)`, replace:

```ts
const results = this.wakeRegistry.evaluate(sourceUrl, event, this.tenantId)
```

with:

```ts
const results = await this.wakeRegistry.evaluate(
  sourceUrl,
  event,
  this.tenantId
)
```

Ensure no code remains that calls `wakeRegistry.loadRegistrations()` or retries `evaluate(...)` after a miss.

- [ ] **Step 5: Update `AgentsHost.start`**

Replace the wake registry startup block in `packages/agents-server/src/host.ts` with:

```ts
if (!this.electricUrl) {
  throw new Error(`WakeRegistry runtime requires an Electric URL`)
}
await this.wakeRegistry.startSync(this.electricUrl, this.electricSecret)
```

- [ ] **Step 6: Update test mocks**

In `packages/agents-server/test/server-start.test.ts`, remove mocked `loadRegistrations()` from `MockWakeRegistry`. Keep:

```ts
startSync(): Promise<void> {
  return Promise.resolve()
}
```

If tests need a local-only registry, use `startLocalForTests()` directly in wake registry unit tests, not host startup tests.

- [ ] **Step 7: Convert direct unit-test evaluations to await**

In `packages/agents-server/test/wake-registry.test.ts`, replace patterns like:

```ts
const results = registry.evaluate(`/child/c1`, event)
```

with:

```ts
const results = await registry.evaluate(`/child/c1`, event)
```

For inline assertions, replace:

```ts
expect(registry.evaluate(`/child/c1`, event)).toHaveLength(1)
```

with:

```ts
await expect(registry.evaluate(`/child/c1`, event)).resolves.toHaveLength(1)
```

- [ ] **Step 8: Run affected tests**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/server-start.test.ts test/wake-registry.test.ts --run
```

Expected: PASS or only failures from tests still asserting deleted manual Shape/cache behavior.

- [ ] **Step 9: Commit**

```bash
git add packages/agents-server/src/entity-manager.ts packages/agents-server/src/host.ts packages/agents-server/src/standalone-runtime.ts packages/agents-server/test/server-start.test.ts packages/agents-server/test/wake-registry.test.ts
git commit -m "Require Electric for wake registry runtime"
```

---

### Task 6: Remove Obsolete Manual Cache Tests and Verify Full Wake Registry Behavior

**Files:**

- Modify: `packages/agents-server/test/wake-registry.test.ts`
- Modify: `packages/agents-server/test/wake-registry-sync.test.ts`
- Modify: `.changeset/fix-deferred-pull-wakes.md`

**Interfaces:**

- Consumes: completed TanStack DB-backed registry and async call sites.
- Produces: passing targeted test suite and updated changeset summary.

- [ ] **Step 1: Delete obsolete manual Shape/cache tests**

Remove tests whose only subject is deleted internals:

```ts
it(`removes cached registrations from shape delete old_value ids`, ...)
it(`ignores malformed shape messages without headers while waiting for up-to-date`, ...)
it(`hydrates and updates the cache from shape changes`, ...)
it(`reloads wake registrations ... cache miss`, ...)
```

Do not delete behavior tests for tenant scoping, wake matching, debounce, timeout, one-shot, unregister, or end-to-end wake delivery.

- [ ] **Step 2: Ensure every unit test starts local registry explicitly**

For every unit test that creates `new WakeRegistry(createMockDb())`, add:

```ts
await registry.startLocalForTests()
```

before `register(...)` or `evaluate(...)`.

Do not add `startLocalForTests()` to integration tests that use `ElectricAgentsServer`, `EntityManager`, or real `TEST_ELECTRIC_URL`; those should exercise runtime `startSync(...)`.

- [ ] **Step 3: Run all wake registry tests**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/wake-registry.test.ts test/wake-registry-sync.test.ts --run
```

Expected: PASS.

- [ ] **Step 4: Run broader affected agent-server tests**

Run:

```bash
pnpm --filter @electric-ax/agents-server test test/server-start.test.ts test/horton-pull-wake-e2e.test.ts test/pg-sync-wake-delivery.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @electric-ax/agents-server typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Update changeset**

Edit `.changeset/fix-deferred-pull-wakes.md` so the `@electric-ax/agents-server` entry mentions the TanStack DB registry refactor. Keep the existing runtime changeset text for `@electric-ax/agents-runtime` intact.

Use wording like:

```md
Refactor the server wake registry to use TanStack DB collections and optimistic actions over `wake_registrations`, removing the manual ShapeStream-backed registration cache and stale-cache reload fallback.
```

- [ ] **Step 7: Validate changeset coverage**

Run:

```bash
GITHUB_BASE_REF=main node scripts/check-changeset.mjs
```

Expected: success message that changesets cover affected packages.

- [ ] **Step 8: Commit**

```bash
git add packages/agents-server/test/wake-registry.test.ts packages/agents-server/test/wake-registry-sync.test.ts .changeset/fix-deferred-pull-wakes.md
git commit -m "Verify TanStack DB wake registry behavior"
```

---

## Self-Review

**Spec coverage:**

- Collection as only in-memory state: Tasks 1, 4, 6 remove `registrationCache`, `Shape`, and Shape tests.
- Runtime Electric collection: Task 4.
- Unit-test local-only collection: Tasks 1, 2, 6.
- Optimistic actions for all mutations: Task 2 and runtime persistence in Task 4.
- `queryOnce` evaluation: Task 1, call sites in Task 5.
- `createEffect` timeout side effects: Task 3.
- Remove reload-on-miss and `loadRegistrations()`: Tasks 4 and 5.
- Tests and verification: Tasks 1-6 include red/green commands and final typecheck.

**Placeholder scan:** No `TBD`, `TODO`, `implement later`, or `similar to Task N` placeholders remain. The one conditional instruction about Drizzle execute shape gives exact fallback code paths and a required return type.

**Type consistency:** The plan consistently uses `WakeRegistrationCollectionRow.id: number` as the TanStack DB key, `WakeRegistry.startLocalForTests()`, async `WakeRegistry.evaluate(...)`, and shared optimistic actions. Later tasks consume names introduced in earlier tasks.
