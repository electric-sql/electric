# Pull-Wake Runner Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** Add comprehensive diagnostics to the pull-wake runner system: client-side state tracking reported via heartbeats, server-side storage + aggregation, and a `GET /_electric/runners/:id/health` endpoint. Also rename `owner_user_id` → `owner_principal` throughout the runners system, storing principal URLs instead of keys.

**Architecture:** Three layers — (1) `PullWakeRunner` tracks 16 diagnostic fields internally and reports them to the server in each heartbeat, (2) the server stores client diagnostics in a new `diagnostics` JSONB column on the `runners` table, (3) a new health endpoint aggregates runner state, client diagnostics, active claims, and dispatch stats into a single response with derived health status.

**Tech Stack:** TypeScript, Drizzle ORM, itty-router, Vitest, PostgreSQL

---

### Task 1: Migration — rename `owner_user_id` and add `diagnostics` column

**Files:**

- Create: `packages/agents-server/drizzle/0007_runner_diagnostics_and_principal.sql`

- [x] **Step 1: Write the migration SQL**

Existing `owner_user_id` values are key-form strings (e.g., `local-desktop`). The new column expects principal URLs (e.g., `/principal/system%3Alocal-desktop`). Since we have no backwards compatibility, the migration deletes existing runner rows — runners are ephemeral and will re-register on next startup. Must also clean up dependent tables (`consumer_claims` and `entity_dispatch_state`) since there are no FK constraints to cascade the deletes.

```sql
UPDATE consumer_claims SET status = 'expired', updated_at = NOW() WHERE status = 'active' AND runner_id IS NOT NULL;
--> statement-breakpoint
UPDATE entity_dispatch_state SET active_runner_id = NULL, active_consumer_id = NULL, active_epoch = NULL, active_claimed_at = NULL, active_lease_expires_at = NULL, updated_at = NOW() WHERE active_runner_id IS NOT NULL;
--> statement-breakpoint
DELETE FROM runners;
--> statement-breakpoint
ALTER TABLE runners RENAME COLUMN owner_user_id TO owner_principal;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_runners_owner_user_id;
--> statement-breakpoint
CREATE INDEX idx_runners_owner_principal ON runners (tenant_id, owner_principal);
--> statement-breakpoint
ALTER TABLE runners ADD COLUMN diagnostics jsonb;
```

- [x] **Step 2: Commit**

```bash
git add packages/agents-server/drizzle/0007_runner_diagnostics_and_principal.sql
git commit -m "feat(agents-server): add migration for runner diagnostics and principal rename"
```

---

### Task 2: Update Drizzle schema and types for principal rename + diagnostics

**Files:**

- Modify: `packages/agents-server/src/db/schema.ts:104-144`
- Modify: `packages/agents-server/src/electric-agents-types.ts:99-136`

- [x] **Step 1: Update the `runners` table in Drizzle schema**

In `packages/agents-server/src/db/schema.ts`, change the `runners` table definition:

```ts
// In the runners column definitions (line 109):
// REPLACE:
    ownerUserId: text(`owner_user_id`).notNull(),
// WITH:
    ownerPrincipal: text(`owner_principal`).notNull(),

// After livenessLeaseExpiresAt (line 118), ADD:
    diagnostics: jsonb(`diagnostics`),

// In the table constraints (line 129):
// REPLACE:
    index(`idx_runners_owner_user_id`).on(table.tenantId, table.ownerUserId),
// WITH:
    index(`idx_runners_owner_principal`).on(table.tenantId, table.ownerPrincipal),
```

- [x] **Step 2: Update the `ElectricAgentsRunner` type**

In `packages/agents-server/src/electric-agents-types.ts`, update the runner types:

```ts
// In ElectricAgentsRunner (line 106-120):
// REPLACE:
export interface ElectricAgentsRunner {
  id: string
  owner_user_id: string
  label: string
  kind: RunnerKind
  admin_status: RunnerAdminStatus
  liveness?: RunnerLiveness
  last_seen_at?: string
  liveness_lease_expires_at?: string
  active_claims?: Array<RunnerActiveClaim>
  wake_stream: string
  wake_stream_offset?: string
  created_at: string
  updated_at: string
}
// WITH:
export interface ElectricAgentsRunner {
  id: string
  owner_principal: string
  label: string
  kind: RunnerKind
  admin_status: RunnerAdminStatus
  liveness?: RunnerLiveness
  last_seen_at?: string
  liveness_lease_expires_at?: string
  active_claims?: Array<RunnerActiveClaim>
  wake_stream: string
  wake_stream_offset?: string
  diagnostics?: Record<string, unknown>
  created_at: string
  updated_at: string
}

// In RegisterRunnerRequest (line 122-129):
// REPLACE:
export interface RegisterRunnerRequest {
  id: string
  owner_user_id: string
  label: string
  kind?: RunnerKind
  admin_status?: RunnerAdminStatus
  wake_stream?: string
}
// WITH:
export interface RegisterRunnerRequest {
  id: string
  owner_principal: string
  label: string
  kind?: RunnerKind
  admin_status?: RunnerAdminStatus
  wake_stream?: string
}
```

- [x] **Step 3: Add `RunnerHealthResponse` and `RunnerHealthStatus` types**

Append to `packages/agents-server/src/electric-agents-types.ts`:

```ts
export type RunnerHealthStatus = `healthy` | `degraded` | `unhealthy`

export interface RunnerHealthResponse {
  runner: {
    id: string
    admin_status: RunnerAdminStatus
    liveness_status: RunnerLiveness | `expired`
    lease_expires_at: string | null
    lease_remaining_ms: number | null
    wake_stream: string
    wake_stream_offset: string | null
    last_seen_at: string | null
    created_at: string
  }
  client: Record<string, unknown> | null
  claims: {
    active_count: number
    active: Array<{
      consumer_id: string
      epoch: number
      entity_url: string
      stream_path: string
      claimed_at: string
      last_heartbeat_at: string | null
      lease_expires_at: string | null
    }>
  }
  dispatch: {
    entities_with_active_claim: number
    entities_with_outstanding_wake: number
    entities_with_pending_work: number
  }
  health: {
    status: RunnerHealthStatus
    issues: Array<string>
  }
}
```

- [x] **Step 4: Commit**

```bash
git add packages/agents-server/src/db/schema.ts packages/agents-server/src/electric-agents-types.ts
git commit -m "feat(agents-server): rename owner_user_id to owner_principal in schema and types, add diagnostics"
```

---

### Task 3: Update entity registry — principal rename, diagnostics storage, health queries

**Files:**

- Modify: `packages/agents-server/src/entity-registry.ts:74-81, 132-190, 193-217, 1148-1168`

- [x] **Step 1: Rename `RegisterRunnerInput.ownerUserId` → `ownerPrincipal`**

In `packages/agents-server/src/entity-registry.ts` (line 74-81):

```ts
// REPLACE:
export interface RegisterRunnerInput {
  id: string
  ownerUserId: string
  label: string
  kind?: RunnerKind
  adminStatus?: RunnerAdminStatus
  wakeStream?: string
}
// WITH:
export interface RegisterRunnerInput {
  id: string
  ownerPrincipal: string
  label: string
  kind?: RunnerKind
  adminStatus?: RunnerAdminStatus
  wakeStream?: string
}
```

- [x] **Step 2: Add `diagnostics` to `HeartbeatRunnerInput`**

In `packages/agents-server/src/entity-registry.ts` (line 83-89):

```ts
// REPLACE:
export interface HeartbeatRunnerInput {
  runnerId: string
  heartbeatAt?: Date
  livenessLeaseExpiresAt?: Date
  leaseMs?: number
  wakeStreamOffset?: string
}
// WITH:
export interface HeartbeatRunnerInput {
  runnerId: string
  heartbeatAt?: Date
  livenessLeaseExpiresAt?: Date
  leaseMs?: number
  wakeStreamOffset?: string
  diagnostics?: Record<string, unknown>
}
```

- [x] **Step 3: Update `createRunner` to use `ownerPrincipal`**

In the `createRunner` method (line 132-167), replace all `ownerUserId` → `ownerPrincipal` references:

```ts
  async createRunner(
    input: RegisterRunnerInput
  ): Promise<ElectricAgentsRunner> {
    const now = new Date()
    const wakeStream = input.wakeStream ?? runnerWakeStream(input.id)

    await this.db
      .insert(runners)
      .values({
        tenantId: this.tenantId,
        id: input.id,
        ownerPrincipal: input.ownerPrincipal,
        label: input.label,
        kind: input.kind ?? `local`,
        adminStatus: input.adminStatus ?? `enabled`,
        wakeStream,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [runners.tenantId, runners.id],
        set: {
          ownerPrincipal: input.ownerPrincipal,
          label: input.label,
          kind: input.kind ?? `local`,
          adminStatus: input.adminStatus ?? `enabled`,
          wakeStream,
          updatedAt: now,
        },
      })

    const runner = await this.getRunner(input.id)
    if (!runner) {
      throw new Error(`Failed to read back runner "${input.id}"`)
    }
    return runner
  }
```

- [x] **Step 4: Update `listRunners` filter**

In `listRunners` (line 178-191):

```ts
// REPLACE:
  async listRunners(filter?: {
    ownerUserId?: string
  }): Promise<Array<ElectricAgentsRunner>> {
    const conditions = [eq(runners.tenantId, this.tenantId)]
    if (filter?.ownerUserId) {
      conditions.push(eq(runners.ownerUserId, filter.ownerUserId))
    }
// WITH:
  async listRunners(filter?: {
    ownerPrincipal?: string
  }): Promise<Array<ElectricAgentsRunner>> {
    const conditions = [eq(runners.tenantId, this.tenantId)]
    if (filter?.ownerPrincipal) {
      conditions.push(eq(runners.ownerPrincipal, filter.ownerPrincipal))
    }
```

- [x] **Step 5: Update `heartbeatRunner` to store diagnostics**

In `heartbeatRunner` (line 193-217):

```ts
  async heartbeatRunner(
    input: HeartbeatRunnerInput
  ): Promise<ElectricAgentsRunner | null> {
    const now = input.heartbeatAt ?? new Date()
    const leaseExpiresAt =
      input.livenessLeaseExpiresAt ??
      new Date(now.getTime() + (input.leaseMs ?? DEFAULT_RUNNER_LEASE_MS))

    const rows = await this.db
      .update(runners)
      .set({
        lastSeenAt: now,
        livenessLeaseExpiresAt: leaseExpiresAt,
        ...(input.wakeStreamOffset !== undefined
          ? { wakeStreamOffset: input.wakeStreamOffset }
          : {}),
        ...(input.diagnostics !== undefined
          ? { diagnostics: input.diagnostics }
          : {}),
        updatedAt: now,
      })
      .where(
        and(eq(runners.tenantId, this.tenantId), eq(runners.id, input.runnerId))
      )
      .returning()

    return rows[0] ? this.rowToRunner(rows[0]) : null
  }
```

- [x] **Step 6: Add `getActiveClaimsForRunner` query**

Add after `materializeReleasedClaim` (around line 367):

```ts
  async getActiveClaimsForRunner(
    runnerId: string
  ): Promise<Array<ConsumerClaim>> {
    const rows = await this.db
      .select()
      .from(consumerClaims)
      .where(
        and(
          eq(consumerClaims.tenantId, this.tenantId),
          eq(consumerClaims.runnerId, runnerId),
          eq(consumerClaims.status, `active`)
        )
      )
    return rows.map((row) => this.rowToConsumerClaim(row))
  }
```

- [x] **Step 7: Add `getDispatchStatsForRunner` query**

Add right after `getActiveClaimsForRunner`:

```ts
  async getDispatchStatsForRunner(
    runnerId: string
  ): Promise<{
    entities_with_active_claim: number
    entities_with_outstanding_wake: number
    entities_with_pending_work: number
  }> {
    const rows = await this.db
      .select()
      .from(entityDispatchState)
      .where(
        and(
          eq(entityDispatchState.tenantId, this.tenantId),
          eq(entityDispatchState.activeRunnerId, runnerId)
        )
      )

    let activeClaim = 0
    let outstandingWake = 0
    let pendingWork = 0
    for (const row of rows) {
      if (row.activeConsumerId) activeClaim++
      if (row.outstandingWakeId && !row.activeConsumerId) outstandingWake++
      const pending = row.pendingSourceStreams as Array<unknown> | null
      if (pending && pending.length > 0) pendingWork++
    }

    return {
      entities_with_active_claim: activeClaim,
      entities_with_outstanding_wake: outstandingWake,
      entities_with_pending_work: pendingWork,
    }
  }
```

- [x] **Step 8: Update `rowToRunner` to include `owner_principal` and `diagnostics`**

In `rowToRunner` (line 1148-1168):

```ts
// REPLACE:
  private rowToRunner(row: typeof runners.$inferSelect): ElectricAgentsRunner {
    const now = Date.now()
    const livenessExpiry = row.livenessLeaseExpiresAt?.getTime()
    return {
      id: row.id,
      owner_user_id: row.ownerUserId,
      label: row.label,
      kind: assertRunnerKind(row.kind),
      admin_status: assertRunnerAdminStatus(row.adminStatus),
      liveness:
        livenessExpiry !== undefined && livenessExpiry > now
          ? `online`
          : `offline`,
      last_seen_at: row.lastSeenAt?.toISOString(),
      liveness_lease_expires_at: row.livenessLeaseExpiresAt?.toISOString(),
      wake_stream: row.wakeStream,
      wake_stream_offset: row.wakeStreamOffset ?? undefined,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }
// WITH:
  private rowToRunner(row: typeof runners.$inferSelect): ElectricAgentsRunner {
    const now = Date.now()
    const livenessExpiry = row.livenessLeaseExpiresAt?.getTime()
    return {
      id: row.id,
      owner_principal: row.ownerPrincipal,
      label: row.label,
      kind: assertRunnerKind(row.kind),
      admin_status: assertRunnerAdminStatus(row.adminStatus),
      liveness:
        livenessExpiry !== undefined && livenessExpiry > now
          ? `online`
          : `offline`,
      last_seen_at: row.lastSeenAt?.toISOString(),
      liveness_lease_expires_at: row.livenessLeaseExpiresAt?.toISOString(),
      wake_stream: row.wakeStream,
      wake_stream_offset: row.wakeStreamOffset ?? undefined,
      diagnostics: (row.diagnostics as Record<string, unknown>) ?? undefined,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }
```

- [x] **Step 9: Commit**

```bash
git add packages/agents-server/src/entity-registry.ts
git commit -m "feat(agents-server): update entity registry for principal rename, diagnostics, and health queries"
```

---

### Task 4: Update runners router, dispatch policy, and shape columns — principal rename, diagnostics in heartbeat, health endpoint

**Files:**

- Modify: `packages/agents-server/src/routing/runners-router.ts`
- Modify: `packages/agents-server/src/routing/dispatch-policy.ts:127`
- Modify: `packages/agents-server/src/utils/server-utils.ts:130-134`

- [x] **Step 1: Update the registration body schema**

In `packages/agents-server/src/routing/runners-router.ts` (line 36-53):

```ts
// REPLACE:
const registerRunnerBodySchema = Type.Object({
  id: Type.String(),
  owner_user_id: Type.Optional(Type.String()),
  label: Type.String(),
  kind: Type.Optional(
    Type.Union([
      Type.Literal(`local`),
      Type.Literal(`cloud-worker`),
      Type.Literal(`sandbox`),
      Type.Literal(`ci`),
      Type.Literal(`server`),
    ])
  ),
  admin_status: Type.Optional(
    Type.Union([Type.Literal(`enabled`), Type.Literal(`disabled`)])
  ),
  wake_stream: Type.Optional(Type.String()),
})
// WITH:
const registerRunnerBodySchema = Type.Object({
  id: Type.String(),
  owner_principal: Type.Optional(Type.String()),
  label: Type.String(),
  kind: Type.Optional(
    Type.Union([
      Type.Literal(`local`),
      Type.Literal(`cloud-worker`),
      Type.Literal(`sandbox`),
      Type.Literal(`ci`),
      Type.Literal(`server`),
    ])
  ),
  admin_status: Type.Optional(
    Type.Union([Type.Literal(`enabled`), Type.Literal(`disabled`)])
  ),
  wake_stream: Type.Optional(Type.String()),
})
```

- [x] **Step 2: Add `diagnostics` to heartbeat body schema**

In the `heartbeatBodySchema` (line 55-60):

```ts
// REPLACE:
const heartbeatBodySchema = Type.Object({
  lease_ms: Type.Optional(Type.Number()),
  wake_stream_offset: Type.Optional(Type.String()),
  wakeStreamOffset: Type.Optional(Type.String()),
  liveness_lease_expires_at: Type.Optional(Type.String()),
})
// WITH:
const heartbeatBodySchema = Type.Object({
  lease_ms: Type.Optional(Type.Number()),
  wake_stream_offset: Type.Optional(Type.String()),
  wakeStreamOffset: Type.Optional(Type.String()),
  liveness_lease_expires_at: Type.Optional(Type.String()),
  diagnostics: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})
```

- [x] **Step 3: Add the health route**

After the existing routes (line 90), add:

```ts
runnersRouter.get(`/:id/health`, runnerHealth)
```

- [x] **Step 4: Add `principalKeyFromUrl` import**

Add to the imports at the top of `runners-router.ts`:

```ts
import { principalKeyFromUrl } from '../principal.js'
```

- [x] **Step 5: Update `registerRunner` handler to use `owner_principal` with strict URL validation**

No backwards compatibility for key-form principals. If `owner_principal` is provided it must be a valid principal URL accepted by `principalKeyFromUrl()` (e.g., `/principal/user%3Aalice`); otherwise the server derives it from `ctx.principal.url`. Callers must send URLs.

In `registerRunner` (line 103-136):

```ts
// REPLACE:
async function registerRunner(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<RegisterRunnerBody>(request)
  const ownerUserId = parsed.owner_user_id ?? ctx.principal?.key
  if (!ownerUserId) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_user_id is required when no authenticated user is present`,
      400
    )
  }
  if (ctx.principal && ownerUserId !== ctx.principal.key) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_user_id must match the authenticated user`,
      403
    )
  }

  const runner = await ctx.entityManager.registry.createRunner({
    id: parsed.id,
    ownerUserId,
    label: parsed.label,
    kind: parsed.kind,
    adminStatus: parsed.admin_status,
    wakeStream: parsed.wake_stream,
  })
  await ctx.streamClient.ensure(runner.wake_stream, {
    contentType: `application/json`,
  })
  return json(runner, { status: 201 })
}
// WITH:
async function registerRunner(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<RegisterRunnerBody>(request)
  const ownerPrincipal = parsed.owner_principal ?? ctx.principal?.url
  if (!ownerPrincipal) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_principal is required when no authenticated principal is present`,
      400
    )
  }
  if (!principalKeyFromUrl(ownerPrincipal)) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_principal must be a valid principal URL accepted by principalKeyFromUrl() (e.g. /principal/user%3Aalice), got: ${ownerPrincipal}`,
      400
    )
  }
  if (ctx.principal && ownerPrincipal !== ctx.principal.url) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_principal must match the authenticated principal`,
      403
    )
  }

  const runner = await ctx.entityManager.registry.createRunner({
    id: parsed.id,
    ownerPrincipal,
    label: parsed.label,
    kind: parsed.kind,
    adminStatus: parsed.admin_status,
    wakeStream: parsed.wake_stream,
  })
  await ctx.streamClient.ensure(runner.wake_stream, {
    contentType: `application/json`,
  })
  return json(runner, { status: 201 })
}
```

- [x] **Step 6: Update `listRunners` handler**

In `listRunners` (line 138-154):

```ts
// REPLACE:
async function listRunners(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const requestedOwner = firstQueryValue(request.query.owner_user_id)
  if (ctx.principal && requestedOwner && requestedOwner !== ctx.principal.key) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_user_id must match the authenticated user`,
      403
    )
  }
  const runners = await ctx.entityManager.registry.listRunners({
    ownerUserId: ctx.principal?.key ?? requestedOwner,
  })
  return json(runners)
}
// WITH:
async function listRunners(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const requestedOwner = firstQueryValue(request.query.owner_principal)
  if (requestedOwner && !principalKeyFromUrl(requestedOwner)) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_principal must be a valid principal URL (e.g. /principal/user%3Aalice), got: ${requestedOwner}`,
      400
    )
  }
  if (ctx.principal && requestedOwner && requestedOwner !== ctx.principal.url) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_principal must match the authenticated principal`,
      403
    )
  }
  const runners = await ctx.entityManager.registry.listRunners({
    ownerPrincipal: ctx.principal?.url ?? requestedOwner,
  })
  return json(runners)
}
```

- [x] **Step 7: Update heartbeat handler to pass diagnostics**

In `heartbeat` (line 165-185), add `diagnostics` to the `heartbeatRunner` call:

```ts
const runner = await ctx.entityManager.registry.heartbeatRunner({
  runnerId,
  leaseMs: parsed.lease_ms,
  wakeStreamOffset: parsed.wake_stream_offset ?? parsed.wakeStreamOffset,
  livenessLeaseExpiresAt: parsed.liveness_lease_expires_at
    ? new Date(parsed.liveness_lease_expires_at)
    : undefined,
  diagnostics: parsed.diagnostics,
})
```

- [x] **Step 8: Update `assertRunnerOwnerIfAuthenticated` to use `principal.url`**

In `assertRunnerOwnerIfAuthenticated` (line 297-308):

```ts
// REPLACE:
function assertRunnerOwnerIfAuthenticated(
  ctx: TenantContext,
  ownerUserId: string
): void {
  if (!ctx.principal) return
  if (ownerUserId === ctx.principal.key) return
  throw new ElectricAgentsError(
    ErrCodeUnauthorized,
    `Runner access requires the authenticated owner`,
    403
  )
}
// WITH:
function assertRunnerOwnerIfAuthenticated(
  ctx: TenantContext,
  ownerPrincipal: string
): void {
  if (!ctx.principal) return
  if (ownerPrincipal === ctx.principal.url) return
  throw new ElectricAgentsError(
    ErrCodeUnauthorized,
    `Runner access requires the authenticated owner`,
    403
  )
}
```

- [x] **Step 9: Update all callers of `assertRunnerOwnerIfAuthenticated`**

Change all calls from `runner.owner_user_id` → `runner.owner_principal`:

In `getRunner` (line 161): `assertRunnerOwnerIfAuthenticated(ctx, runner.owner_principal)`

In `heartbeat` (line 171): `assertRunnerOwnerIfAuthenticated(ctx, existing.owner_principal)`

In `setRunnerStatus` (line 208): `assertRunnerOwnerIfAuthenticated(ctx, existing.owner_principal)`

- [x] **Step 10: Update claim auth check**

In `claimWake` (line 225):

```ts
// REPLACE:
  if (ctx.principal && runner.owner_user_id !== ctx.principal.key) {
// WITH:
  if (ctx.principal && runner.owner_principal !== ctx.principal.url) {
```

- [x] **Step 11: Update `assertDispatchPolicyAllowed` in dispatch-policy.ts**

In `packages/agents-server/src/routing/dispatch-policy.ts` (line 127):

```ts
// REPLACE:
  if (ctx.principal && runner.owner_user_id !== ctx.principal.key) {
// WITH:
  if (ctx.principal && runner.owner_principal !== ctx.principal.url) {
```

- [x] **Step 12: Update runners Shape column allowlist in server-utils.ts**

In `packages/agents-server/src/utils/server-utils.ts` (line 131-133):

```ts
// REPLACE:
;`"tenant_id","id","owner_user_id","label","kind","admin_status","wake_stream","wake_stream_offset","last_seen_at","liveness_lease_expires_at","created_at","updated_at"`
// WITH:
`"tenant_id","id","owner_principal","label","kind","admin_status","wake_stream","wake_stream_offset","last_seen_at","liveness_lease_expires_at","diagnostics","created_at","updated_at"`
```

- [x] **Step 13: Implement `runnerHealth` handler**

Add at the bottom of the file, before `notificationFromClaim`:

```ts
async function runnerHealth(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runnerId = routeParam(request, `id`)
  const runner = await requireRunner(ctx, runnerId)
  assertRunnerOwnerIfAuthenticated(ctx, runner.owner_principal)

  const now = Date.now()
  const leaseExpiresAt = runner.liveness_lease_expires_at
    ? new Date(runner.liveness_lease_expires_at).getTime()
    : null

  const livenessStatus =
    runner.admin_status === `disabled`
      ? `offline`
      : leaseExpiresAt !== null && leaseExpiresAt > now
        ? `online`
        : leaseExpiresAt !== null
          ? `expired`
          : `offline`

  const [activeClaims, dispatchStats] = await Promise.all([
    ctx.entityManager.registry.getActiveClaimsForRunner(runnerId),
    ctx.entityManager.registry.getDispatchStatsForRunner(runnerId),
  ])

  const clientDiagnostics = runner.diagnostics ?? null

  const issues: Array<string> = []
  let healthStatus: `healthy` | `degraded` | `unhealthy` = `healthy`

  if (runner.admin_status === `disabled`) {
    healthStatus = `unhealthy`
    issues.push(`Runner is disabled`)
  }
  if (livenessStatus === `expired`) {
    healthStatus = `unhealthy`
    const ago = leaseExpiresAt ? Math.round((now - leaseExpiresAt) / 1000) : 0
    issues.push(`Heartbeat lease expired ${ago}s ago`)
  }
  if (livenessStatus === `offline` && runner.admin_status === `enabled`) {
    healthStatus = healthStatus === `unhealthy` ? `unhealthy` : `degraded`
    issues.push(`Runner has never sent a heartbeat`)
  }
  if (clientDiagnostics) {
    if (clientDiagnostics.stream_connected === false) {
      if (healthStatus === `healthy`) healthStatus = `degraded`
      issues.push(`Client reports stream disconnected`)
    }
    if (clientDiagnostics.last_heartbeat_ok === false) {
      if (healthStatus === `healthy`) healthStatus = `degraded`
      issues.push(`Client reports last heartbeat failed`)
    }
    if (
      typeof clientDiagnostics.reconnect_count === `number` &&
      clientDiagnostics.reconnect_count > 5
    ) {
      if (healthStatus === `healthy`) healthStatus = `degraded`
      issues.push(
        `Client has reconnected ${clientDiagnostics.reconnect_count} times`
      )
    }
  } else if (runner.last_seen_at) {
    if (healthStatus === `healthy`) healthStatus = `degraded`
    issues.push(`No client diagnostics available`)
  }

  return json({
    runner: {
      id: runner.id,
      admin_status: runner.admin_status,
      liveness_status: livenessStatus,
      lease_expires_at: runner.liveness_lease_expires_at ?? null,
      lease_remaining_ms:
        leaseExpiresAt !== null ? Math.max(0, leaseExpiresAt - now) : null,
      wake_stream: runner.wake_stream,
      wake_stream_offset: runner.wake_stream_offset ?? null,
      last_seen_at: runner.last_seen_at ?? null,
      created_at: runner.created_at,
    },
    client: clientDiagnostics,
    claims: {
      active_count: activeClaims.length,
      active: activeClaims.map((c) => ({
        consumer_id: c.consumer_id,
        epoch: c.epoch,
        entity_url: c.entity_url,
        stream_path: c.stream_path,
        claimed_at: c.claimed_at,
        last_heartbeat_at: c.last_heartbeat_at ?? null,
        lease_expires_at: c.lease_expires_at ?? null,
      })),
    },
    dispatch: dispatchStats,
    health: { status: healthStatus, issues },
  })
}
```

- [x] **Step 14: Commit**

```bash
git add packages/agents-server/src/routing/runners-router.ts packages/agents-server/src/routing/dispatch-policy.ts packages/agents-server/src/utils/server-utils.ts
git commit -m "feat(agents-server): update runners router, dispatch policy, and shape columns for principal rename, diagnostics, and health endpoint"
```

---

### Task 5: Client-side diagnostics in PullWakeRunner

**Files:**

- Modify: `packages/agents-runtime/src/pull-wake-runner.ts`

- [x] **Step 1: Add `PullWakeRunnerHealth` interface and diagnostics tracking**

In `packages/agents-runtime/src/pull-wake-runner.ts`, after the existing `PullWakeRunner` interface (line 48-54), add:

```ts
export interface PullWakeRunnerHealth {
  running: boolean
  offset: string | undefined
  started_at: string | null
  stream_connected: boolean
  stream_connected_since: string | null
  reconnect_count: number
  last_error: string | null
  last_error_at: string | null
  last_heartbeat_at: string | null
  last_heartbeat_ok: boolean
  last_claim_at: string | null
  last_claim_result: `claimed` | `no_work` | `error` | null
  last_dispatch_at: string | null
  events_received: number
  claims_succeeded: number
  claims_skipped: number
  claims_failed: number
}
```

Add `getHealth` to the `PullWakeRunner` interface:

```ts
export interface PullWakeRunner {
  start: () => void
  stop: () => Promise<void>
  waitForStopped: () => Promise<void>
  readonly running: boolean
  readonly offset: string | undefined
  getHealth: () => PullWakeRunnerHealth
}
```

- [x] **Step 2: Add diagnostic state variables inside `createPullWakeRunner`**

After the existing `let currentOffset = config.offset` (line 63), add:

```ts
let startedAt: string | null = null
let streamConnected = false
let streamConnectedSince: string | null = null
let reconnectCount = 0
let lastError: string | null = null
let lastErrorAt: string | null = null
let lastHeartbeatAt: string | null = null
let lastHeartbeatOk = false
let lastClaimAt: string | null = null
let lastClaimResult: PullWakeRunnerHealth[`last_claim_result`] = null
let lastDispatchAt: string | null = null
let eventsReceived = 0
let claimsSucceeded = 0
let claimsSkipped = 0
let claimsFailed = 0
```

- [x] **Step 3: Build the diagnostics snapshot function**

Add after the diagnostic variables:

```ts
const buildDiagnostics = (): Omit<
  PullWakeRunnerHealth,
  `running` | `offset`
> => ({
  started_at: startedAt,
  stream_connected: streamConnected,
  stream_connected_since: streamConnectedSince,
  reconnect_count: reconnectCount,
  last_error: lastError,
  last_error_at: lastErrorAt,
  last_heartbeat_at: lastHeartbeatAt,
  last_heartbeat_ok: lastHeartbeatOk,
  last_claim_at: lastClaimAt,
  last_claim_result: lastClaimResult,
  last_dispatch_at: lastDispatchAt,
  events_received: eventsReceived,
  claims_succeeded: claimsSucceeded,
  claims_skipped: claimsSkipped,
  claims_failed: claimsFailed,
})
```

- [x] **Step 4: Update `heartbeat` to report diagnostics and track heartbeat state**

Replace the existing `heartbeat` function (line 106-131):

```ts
const heartbeat = async (signal: AbortSignal): Promise<void> => {
  try {
    const headers = new Headers(await resolveHeaders())
    headers.set(`content-type`, `application/json`)
    const res = await fetch(heartbeatUrl, {
      method: `POST`,
      headers,
      body: JSON.stringify({
        lease_ms: leaseMs,
        ...(currentOffset !== undefined
          ? { wake_stream_offset: currentOffset }
          : {}),
        diagnostics: buildDiagnostics(),
      }),
      signal,
    })
    lastHeartbeatAt = new Date().toISOString()
    if (!res.ok) {
      lastHeartbeatOk = false
      throw new Error(
        `Pull-wake runner heartbeat failed for ${config.runnerId}: ${res.status} ${await res.text()}`
      )
    }
    lastHeartbeatOk = true
  } catch (err) {
    if (!signal.aborted) {
      lastHeartbeatOk = false
      config.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }
}
```

- [x] **Step 5: Update `reportError` to track errors**

Replace the existing `reportError` (line 101-104):

```ts
const reportError = (err: unknown): void => {
  const error = err instanceof Error ? err : new Error(String(err))
  lastError = error.message
  lastErrorAt = new Date().toISOString()
  if (config.onError?.(error) !== true) throw error
}
```

- [x] **Step 6: Update `claimWake` to track claim results**

Replace the existing `claimWake` (line 170-200):

```ts
const claimWake = async (
  event: PullWakeEvent,
  signal: AbortSignal
): Promise<WakeNotification | null> => {
  lastClaimAt = new Date().toISOString()
  const headers = new Headers(await resolveHeaders())
  headers.set(`content-type`, `application/json`)
  try {
    const response = await fetch(claimUrl, {
      method: `POST`,
      headers,
      signal,
      body: JSON.stringify(event),
    })
    if (response.status === 204) {
      lastClaimResult = `no_work`
      claimsSkipped++
      return null
    }
    if (!response.ok) {
      const text = await response.text()
      if (
        response.status === 409 &&
        (text.includes(`ALREADY_CLAIMED`) || text.includes(`NO_PENDING_WORK`))
      ) {
        lastClaimResult = `no_work`
        claimsSkipped++
        return null
      }
      lastClaimResult = `error`
      claimsFailed++
      throw new Error(
        `Pull-wake claim failed for ${config.runnerId}: ${response.status} ${text}`
      )
    }
    const notification = (await response.json()) as WakeNotification & {
      done?: boolean
    }
    if (notification.done) {
      lastClaimResult = `no_work`
      claimsSkipped++
      return null
    }
    lastClaimResult = `claimed`
    claimsSucceeded++
    return notification
  } catch (err) {
    if (lastClaimResult !== `no_work` && lastClaimResult !== `error`) {
      lastClaimResult = `error`
      claimsFailed++
    }
    throw err
  }
}
```

- [x] **Step 7: Update the `run` function to track stream and event state**

Replace the existing `run` function (line 202-236):

```ts
const run = async (): Promise<void> => {
  const signal = controller!.signal
  try {
    response = await streamFactory({
      url: wakeUrl,
      headers: await resolveHeaders(),
      offset: currentOffset,
      signal,
    })
    streamConnected = true
    streamConnectedSince = new Date().toISOString()
    for await (const event of response.jsonStream()) {
      if (signal.aborted) break
      if (event?.type !== `wake`) continue
      eventsReceived++
      const notification = await claimWake(event, signal)
      if (notification) {
        config.runtime.dispatchWake(notification, {
          claimHeaders: resolveClaimHeaders,
          claimTokenHeader: config.claimTokenHeader,
        })
        lastDispatchAt = new Date().toISOString()
        await config.runtime.drainWakes()
      }
      if (response.offset !== undefined) currentOffset = response.offset
    }
    await response.closed?.catch((err) => {
      if (!signal.aborted) throw err
    })
  } catch (err) {
    if (!signal.aborted) {
      reconnectCount++
      reportError(err)
    }
  } finally {
    streamConnected = false
    stopHeartbeat()
    response = null
    controller = null
  }
}
```

- [x] **Step 8: Update `start()` to record `startedAt`**

In the returned object's `start()` method (line 239-244):

```ts
    start() {
      if (loop) return
      controller = new AbortController()
      startedAt = new Date().toISOString()
      startHeartbeat(controller.signal)
      loop = run().finally(() => {
        loop = null
      })
    },
```

- [x] **Step 9: Add `getHealth()` to the returned object**

Add after the `offset` getter:

```ts
    getHealth(): PullWakeRunnerHealth {
      return {
        running: loop !== null,
        offset: currentOffset,
        ...buildDiagnostics(),
      }
    },
```

- [x] **Step 10: Update the runtime index exports**

In `packages/agents-runtime/src/index.ts`, add `PullWakeRunnerHealth` to the exports (line 238-243):

```ts
// REPLACE:
export type {
  PullWakeEvent,
  PullWakeRunner,
  PullWakeRunnerConfig,
  PullWakeStreamResponse,
} from './pull-wake-runner'
// WITH:
export type {
  PullWakeEvent,
  PullWakeRunner,
  PullWakeRunnerConfig,
  PullWakeRunnerHealth,
  PullWakeStreamResponse,
} from './pull-wake-runner'
```

- [x] **Step 11: Commit**

```bash
git add packages/agents-runtime/src/pull-wake-runner.ts packages/agents-runtime/src/index.ts
git commit -m "feat(agents-runtime): add diagnostics tracking and getHealth() to PullWakeRunner"
```

---

### Task 6: Update BuiltinAgentsServer, electric-ax, and desktop app for principal rename

**Files:**

- Modify: `packages/agents/src/server.ts:40-51, 393-422`
- Modify: `packages/electric-ax/src/start.ts:131-139, 379, 395`
- Modify: `packages/agents-desktop/src/main.ts:219-274, 1544-1582`

- [x] **Step 1: Update `BuiltinAgentsServerOptions` in agents/server.ts**

In `packages/agents/src/server.ts` (line 40-51):

```ts
// REPLACE:
  pullWake: {
    runnerId: string
    ownerUserId?: string
    label?: string
    registerRunner?: boolean
// WITH:
  pullWake: {
    runnerId: string
    ownerPrincipal?: string
    label?: string
    registerRunner?: boolean
```

- [x] **Step 2: Update `registerPullWakeRunner` to use `owner_principal`**

In `packages/agents/src/server.ts` (line 393-422):

```ts
// REPLACE:
        body: JSON.stringify({
          id: pullWake.runnerId,
          owner_user_id: pullWake.ownerUserId,
          label: pullWake.label ?? `Built-in agents`,
          kind: `local`,
          admin_status: `enabled`,
        }),
// WITH:
        body: JSON.stringify({
          id: pullWake.runnerId,
          owner_principal: pullWake.ownerPrincipal,
          label: pullWake.label ?? `Built-in agents`,
          kind: `local`,
          admin_status: `enabled`,
        }),
```

- [x] **Step 3: Update electric-ax/src/start.ts**

In `packages/electric-ax/src/start.ts`:

First, rename the default constant (line 21). Store a principal URL directly:

```ts
// REPLACE:
const DEFAULT_PULL_WAKE_OWNER_ID = `builtin-agents`
// WITH:
const DEFAULT_PULL_WAKE_OWNER_PRINCIPAL = `/principal/system%3Abuiltin-agents`
```

Then rename the function (line 131-139). `ELECTRIC_AGENTS_IDENTITY` is a principal key (`kind:id`), so convert it to a URL. The default is already a URL:

```ts
// REPLACE:
export function resolvePullWakeOwnerId(
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): string {
  return (
    readConfigValue(env, fileEnv, [`ELECTRIC_AGENTS_IDENTITY`]) ??
    DEFAULT_PULL_WAKE_OWNER_ID
  )
}
// WITH:
export function resolvePullWakeOwnerPrincipal(
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): string {
  const identity = readConfigValue(env, fileEnv, [`ELECTRIC_AGENTS_IDENTITY`])
  if (identity) return `/principal/${encodeURIComponent(identity)}`
  return DEFAULT_PULL_WAKE_OWNER_PRINCIPAL
}
```

Update the usage (line 379):

```ts
// REPLACE:
const ownerUserId = resolvePullWakeOwnerId(env, fileEnv)
// WITH:
const ownerPrincipal = resolvePullWakeOwnerPrincipal(env, fileEnv)
```

Update the `BuiltinAgentsServer` call (line 395):

```ts
// REPLACE:
      ownerUserId,
// WITH:
      ownerPrincipal,
```

- [x] **Step 4: Update desktop env var and function names**

In `packages/agents-desktop/src/main.ts`:

Rename the constant (line 227-229). No backwards-compat fallback — clean break. Store a principal URL directly:

```ts
// REPLACE:
const PULL_WAKE_OWNER_USER_ID =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_OWNER_USER_ID?.trim() ||
  `local-desktop`
// WITH:
const PULL_WAKE_OWNER_PRINCIPAL =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_OWNER_PRINCIPAL?.trim() ||
  `/principal/system%3Alocal-desktop`
```

Rename the helper function (line 265-274). Do NOT use the `authorization` header as a principal source — that's a bearer token, not a principal key. When the request has auth headers, the server middleware extracts `ctx.principal` from them and uses `ctx.principal.url` as the owner. So when only auth is present (no explicit `electric-principal` header), return `undefined` to let the server derive the owner:

```ts
// REPLACE:
function runnerOwnerUserIdFromHeaders(
  headers: Record<string, string> | undefined
): string {
  const normalized = new Headers(headers)
  return (
    normalized.get(`authorization`)?.trim() ||
    normalized.get(ELECTRIC_PRINCIPAL_HEADER)?.trim() ||
    PULL_WAKE_OWNER_USER_ID
  )
}
// WITH:
function runnerOwnerPrincipalFromHeaders(
  headers: Record<string, string> | undefined
): string | undefined {
  const normalized = new Headers(headers)
  const principalKey = normalized.get(ELECTRIC_PRINCIPAL_HEADER)?.trim()
  if (principalKey) {
    return principalKey.startsWith(`/principal/`)
      ? principalKey
      : `/principal/${encodeURIComponent(principalKey)}`
  }
  if (normalized.has(`authorization`)) return undefined
  return PULL_WAKE_OWNER_PRINCIPAL
}
```

Update usage (line 1544, 1551, 1575):

```ts
// REPLACE:
const runnerOwnerUserId = runnerOwnerUserIdFromHeaders(runtimeHeaders)
// WITH:
const runnerOwnerPrincipal = runnerOwnerPrincipalFromHeaders(runtimeHeaders)
```

```ts
// REPLACE:
      ownerUserId: PULL_WAKE_REGISTER_RUNNER ? runnerOwnerUserId : undefined,
// WITH:
      ownerPrincipal: PULL_WAKE_REGISTER_RUNNER ? runnerOwnerPrincipal : undefined,
```

Update log messages referencing `owner user id` → `owner principal`.

- [x] **Step 5: Commit**

```bash
git add packages/agents/src/server.ts packages/electric-ax/src/start.ts packages/agents-desktop/src/main.ts
git commit -m "feat(agents, electric-ax, agents-desktop): rename ownerUserId to ownerPrincipal for runner registration"
```

---

### Task 7: Update tests for principal rename and health endpoint

**Files:**

- Modify: `packages/agents-server/test/runners-router.test.ts`
- Modify: `packages/agents-runtime/test/pull-wake-runner.test.ts`
- Modify: `packages/agents-server/test/horton-pull-wake-e2e.test.ts`
- Modify: `packages/agents-server/test/horton-title-generation.test.ts`
- Modify: `packages/agents-server/test/horton-spawn-worker.test.ts`
- Modify: `packages/agents-server/test/dispatch-policy-routing.test.ts`

- [x] **Step 1: Update runners-router.test.ts — principal rename and context**

In `packages/agents-server/test/runners-router.test.ts`:

Update the `runner()` helper (line 15-28):

```ts
// REPLACE:
    owner_user_id: `user:owner@example.com`,
// WITH:
    owner_principal: `/principal/user%3Aowner%40example.com`,
```

Update `buildContext` registry mock (line 33-35):

```ts
// REPLACE:
    createRunner: vi.fn(async (input) =>
      runner({
        id: input.id,
        owner_user_id: input.ownerUserId,
// WITH:
    createRunner: vi.fn(async (input) =>
      runner({
        id: input.id,
        owner_principal: input.ownerPrincipal,
```

Update all test assertions that reference `owner_user_id`:

- Line 89: `owner_user_id: `other@example.com``→`owner_principal: `/principal/other`
- Line 118: `owner_user_id: `user:owner@example.com`` → `owner_principal: `/principal/user%3Aowner%40example.com``
- Line 128-129: `ownerUserId: `user:owner@example.com`` → `ownerPrincipal: `/principal/user%3Aowner%40example.com``
- Line 158-159: same replacement

- [x] **Step 2: Add health endpoint test to runners-router.test.ts**

Add to the `runner routes` describe block:

```ts
it(`returns runner health with diagnostics and claim state`, async () => {
  const ctx = buildContext({
    principal: {
      kind: `user`,
      id: `owner@example.com`,
      key: `user:owner@example.com`,
      url: `/principal/user%3Aowner%40example.com`,
    },
  })
  vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
    runner({
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      diagnostics: {
        stream_connected: true,
        reconnect_count: 0,
        last_heartbeat_ok: true,
      },
    })
  )
  ctx.entityManager.registry.getActiveClaimsForRunner = vi.fn(async () => [])
  ctx.entityManager.registry.getDispatchStatsForRunner = vi.fn(async () => ({
    entities_with_active_claim: 0,
    entities_with_outstanding_wake: 0,
    entities_with_pending_work: 0,
  }))

  const response = await globalRouter.fetch(
    request(`GET`, `/_electric/runners/runner-1/health`),
    ctx
  )

  expect(response.status).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  expect(body.runner).toMatchObject({
    id: `runner-1`,
    liveness_status: `online`,
  })
  expect(body.client).toMatchObject({ stream_connected: true })
  expect(body.claims).toMatchObject({ active_count: 0 })
  expect(body.health).toMatchObject({ status: `healthy`, issues: [] })
})

it(`returns unhealthy when runner lease is expired`, async () => {
  const ctx = buildContext({
    principal: {
      kind: `user`,
      id: `owner@example.com`,
      key: `user:owner@example.com`,
      url: `/principal/user%3Aowner%40example.com`,
    },
  })
  vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
    runner({
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() - 10_000).toISOString(),
      last_seen_at: new Date(Date.now() - 15_000).toISOString(),
    })
  )
  ctx.entityManager.registry.getActiveClaimsForRunner = vi.fn(async () => [])
  ctx.entityManager.registry.getDispatchStatsForRunner = vi.fn(async () => ({
    entities_with_active_claim: 0,
    entities_with_outstanding_wake: 0,
    entities_with_pending_work: 0,
  }))

  const response = await globalRouter.fetch(
    request(`GET`, `/_electric/runners/runner-1/health`),
    ctx
  )

  expect(response.status).toBe(200)
  const body = (await response.json()) as Record<string, unknown>
  expect((body.health as any).status).toBe(`unhealthy`)
  expect((body.health as any).issues.length).toBeGreaterThan(0)
})
```

- [x] **Step 3: Add `getHealth()` test to pull-wake-runner.test.ts**

Add to the `createPullWakeRunner` describe block in `packages/agents-runtime/test/pull-wake-runner.test.ts`:

```ts
it(`exposes diagnostics via getHealth()`, async () => {
  const event: PullWakeEvent = {
    type: `wake`,
    subscription_id: `runner:runner-1`,
    stream: `chat/one/main`,
    generation: 7,
    ts: 123,
  }
  const notification: WakeNotification = {
    consumerId: `wake-1`,
    epoch: 7,
    wakeId: `wake-1`,
    streamPath: `/chat/one/main`,
    streams: [{ path: `/chat/one/main`, offset: `12` }],
    callback: `http://server/_electric/callback-forward/wake-1`,
    claimToken: `claim-token`,
    entity: {
      type: `chat`,
      status: `idle`,
      url: `/chat/one`,
      streams: { main: `/chat/one/main`, error: `/chat/one/error` },
    },
  }
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json(notification)
  )
  vi.stubGlobal(`fetch`, fetchMock)
  const streamFactory = vi.fn(async () => ({
    offset: `42`,
    async *jsonStream() {
      yield event
    },
    closed: Promise.resolve(),
  }))

  const runner = createPullWakeRunner({
    baseUrl: `http://server`,
    runnerId: `runner-1`,
    runtime: {
      dispatchWake: vi.fn(),
      drainWakes: vi.fn(async () => undefined),
      abortWakes: vi.fn(),
    },
    heartbeatIntervalMs: 0,
    streamFactory,
  })

  const healthBefore = runner.getHealth()
  expect(healthBefore.running).toBe(false)
  expect(healthBefore.started_at).toBeNull()
  expect(healthBefore.events_received).toBe(0)

  runner.start()
  await runner.waitForStopped()

  const healthAfter = runner.getHealth()
  expect(healthAfter.running).toBe(false)
  expect(healthAfter.started_at).not.toBeNull()
  expect(healthAfter.events_received).toBe(1)
  expect(healthAfter.claims_succeeded).toBe(1)
  expect(healthAfter.last_claim_result).toBe(`claimed`)
  expect(healthAfter.last_dispatch_at).not.toBeNull()
  expect(healthAfter.offset).toBe(`42`)
})
```

- [x] **Step 4: Update horton-pull-wake-e2e.test.ts for principal rename**

In `packages/agents-server/test/horton-pull-wake-e2e.test.ts` (line 133):

```ts
// REPLACE:
        ownerUserId: testPrincipal.key,
// WITH:
        ownerPrincipal: testPrincipal.url,
```

- [x] **Step 5: Update horton-title-generation.test.ts and horton-spawn-worker.test.ts**

In `packages/agents-server/test/horton-title-generation.test.ts` (line 39):

```ts
// REPLACE:
          ownerUserId: `test-user`,
// WITH:
          ownerPrincipal: `/principal/system%3Atest-user`,
```

In `packages/agents-server/test/horton-spawn-worker.test.ts` (line 39):

```ts
// REPLACE:
          ownerUserId: `test-user`,
// WITH:
          ownerPrincipal: `/principal/system%3Atest-user`,
```

- [x] **Step 6: Update dispatch-policy-routing.test.ts**

In `packages/agents-server/test/dispatch-policy-routing.test.ts` (line 71):

```ts
// REPLACE:
          owner_user_id: `user:owner@example.com`,
// WITH:
          owner_principal: `/principal/user%3Aowner%40example.com`,
```

- [x] **Step 7: Run all tests**

Run: `cd packages/agents-runtime && pnpm vitest run test/pull-wake-runner.test.ts --reporter=dot`

Run: `cd packages/agents-server && pnpm vitest run test/runners-router.test.ts --reporter=dot`

Expected: All tests PASS

- [x] **Step 8: Commit**

```bash
git add packages/agents-server/test/ packages/agents-runtime/test/
git commit -m "test: update all tests for principal rename and add health endpoint tests"
```

---

### Task 8: Typecheck and final verification

- [x] **Step 1: Typecheck agents-runtime**

Run: `pnpm -C packages/agents-runtime build`
Expected: No errors

- [x] **Step 2: Typecheck agents-server**

Run: `pnpm --filter @electric-ax/agents-server typecheck`
Expected: No errors

- [x] **Step 3: Typecheck agents**

Run: `pnpm --filter @electric-ax/agents typecheck`
Expected: No errors

- [x] **Step 4: Typecheck agents-desktop**

Run: `pnpm --filter @electric-ax/agents-desktop typecheck`
Expected: No errors

- [x] **Step 5: Run unit tests**

Run: `cd packages/agents-runtime && pnpm vitest run test/pull-wake-runner.test.ts --reporter=dot`
Run: `cd packages/agents-server && pnpm vitest run test/runners-router.test.ts --reporter=dot`
Expected: All PASS

- [x] **Step 6: Fix any issues and commit**

If any typecheck or test failures, fix and commit:

```bash
git commit -m "fix: address typecheck and test issues from health check implementation"
```
