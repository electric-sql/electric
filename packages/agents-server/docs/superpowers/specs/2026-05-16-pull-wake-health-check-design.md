# Pull-Wake Runner Health Check

## Problem

The pull-wake dispatch system is unreliable and there's no way to diagnose what's going wrong. We need:

1. A **health check endpoint** (`GET /_electric/runners/:id/health`) for deep debugging — curl it to see comprehensive diagnostics about a runner's dispatch pipeline.
2. **Rich runner state in Postgres** so that apps can sync the `runners` table via an Electric Shape and show runner status on any device (e.g. see your laptop runner's status from your phone).

The `diagnostics` JSONB column on the `runners` table serves both purposes: the health endpoint reads it for the detailed response, and Shape sync delivers it reactively to any connected client.

## Design

### Layer 1: Client-Side Diagnostics (PullWakeRunner)

Add internal state tracking to `createPullWakeRunner` in `packages/agents-runtime/src/pull-wake-runner.ts`.

**Tracked state:**

| Field                    | Type                                  | Description                                        |
| ------------------------ | ------------------------------------- | -------------------------------------------------- |
| `started_at`             | ISO string                            | When `start()` was called                          |
| `stream_connected`       | boolean                               | Whether the stream iterator is actively yielding   |
| `stream_connected_since` | ISO string                            | When the current stream connection was established |
| `reconnect_count`        | number                                | Total reconnection attempts since start            |
| `last_error`             | string                                | Most recent error message                          |
| `last_error_at`          | ISO string                            | When the last error occurred                       |
| `last_heartbeat_at`      | ISO string                            | When the last heartbeat was sent                   |
| `last_heartbeat_ok`      | boolean                               | Whether the last heartbeat succeeded               |
| `last_claim_at`          | ISO string                            | When the last claim attempt was made               |
| `last_claim_result`      | `"claimed"` / `"no_work"` / `"error"` | Result of the last claim                           |
| `last_dispatch_at`       | ISO string                            | When the last wake was dispatched to the runtime   |
| `events_received`        | number                                | Total wake events received from the stream         |
| `claims_succeeded`       | number                                | Total successful claims                            |
| `claims_skipped`         | number                                | Claims that returned no work / already claimed     |
| `claims_failed`          | number                                | Claims that errored                                |

**New interface method:**

```ts
export interface PullWakeRunner {
  // ... existing
  getHealth: () => PullWakeRunnerHealth
}

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
  last_claim_result: 'claimed' | 'no_work' | 'error' | null
  last_dispatch_at: string | null
  events_received: number
  claims_succeeded: number
  claims_skipped: number
  claims_failed: number
}
```

**Reporting to server:** The heartbeat POST body already sends `lease_ms` and `wake_stream_offset`. Extend it with a `diagnostics` field containing the tracked state above. The server persists this in the runners table.

### Layer 2: Server-Side Storage

Add a `diagnostics` JSONB column to the `runners` table via migration `0007_runner_diagnostics.sql`.

The `heartbeatRunner` method in `PostgresRegistry` stores the diagnostics payload from the heartbeat request.

The `ElectricAgentsRunner` type gains an optional `diagnostics` field.

### Principal-Based Ownership Rename

The existing `owner_user_id` column and field name is a misnomer — principals aren't limited to users. They include `agent:`, `service:`, and `system:` actors. The canonical identifier is the principal URL (e.g. `/principal/user%3Aalice`), not the key (`user:alice`).

As part of this work, rename across the runners system:

- **DB column**: `owner_user_id` → `owner_principal` (migration)
- **Drizzle schema**: `ownerUserId` → `ownerPrincipal`
- **Types**: `ElectricAgentsRunner.owner_user_id` → `ElectricAgentsRunner.owner_principal`
- **API body/query**: `owner_user_id` → `owner_principal`
- **Auth checks**: compare against `ctx.principal.url` instead of `ctx.principal.key`
- **Registry methods**: `ownerUserId` param → `ownerPrincipal`

The stored value is the principal URL (`/principal/user%3Aalice`), which is the primary identifier for everything in the system.

### Multi-Device Runner Status via Shape Sync

Apps sync the `runners` table via an Electric Shape scoped to `owner_principal`. This gives reactive runner status on any device without polling. The table row provides everything a UI needs:

- **Online/offline**: derive from `liveness_lease_expires_at` vs current time
- **Admin status**: `admin_status` column (`enabled`/`disabled`)
- **Owner**: `owner_principal` — the principal URL, for Shape scoping (`WHERE owner_principal = :my_principal_url`)
- **Stream connected**: `diagnostics.stream_connected`
- **Last error**: `diagnostics.last_error` + `diagnostics.last_error_at`
- **Activity**: `diagnostics.last_claim_at`, `diagnostics.last_dispatch_at`
- **Counters**: `diagnostics.events_received`, `diagnostics.claims_succeeded`, etc.

The health endpoint aggregates additional server-side state (active claims, dispatch stats) that isn't in the runners table — it's the "explain what's happening right now" view for debugging. The Shape is the "show me my runners" view for apps.

### Layer 3: Health Endpoint

**Route:** `GET /_electric/runners/:id/health`

Added to `runners-router.ts` alongside the existing runner CRUD routes. Same auth as `getRunner` — owner must match authenticated principal.

**Response shape:**

```json
{
  "runner": {
    "id": "desktop-abc123",
    "admin_status": "enabled",
    "liveness_status": "online",
    "lease_expires_at": "2026-05-16T12:00:30Z",
    "lease_remaining_ms": 12345,
    "wake_stream": "/runners/desktop-abc123/wake",
    "wake_stream_offset": "0_3",
    "last_seen_at": "2026-05-16T12:00:00Z",
    "created_at": "2026-05-16T11:00:00Z"
  },
  "client": {
    "started_at": "2026-05-16T11:00:01Z",
    "stream_connected": true,
    "stream_connected_since": "2026-05-16T11:00:02Z",
    "reconnect_count": 0,
    "last_error": null,
    "last_error_at": null,
    "last_heartbeat_at": "2026-05-16T12:00:00Z",
    "last_heartbeat_ok": true,
    "last_claim_at": "2026-05-16T11:55:00Z",
    "last_claim_result": "claimed",
    "last_dispatch_at": "2026-05-16T11:55:01Z",
    "events_received": 14,
    "claims_succeeded": 10,
    "claims_skipped": 3,
    "claims_failed": 1
  },
  "claims": {
    "active_count": 1,
    "active": [
      {
        "consumer_id": "wake-001",
        "epoch": 3,
        "entity_url": "/entities/coder/session-42",
        "stream_path": "/coder/session-42/main",
        "claimed_at": "2026-05-16T11:55:00Z",
        "last_heartbeat_at": "2026-05-16T12:00:00Z",
        "lease_expires_at": "2026-05-16T12:00:30Z"
      }
    ]
  },
  "dispatch": {
    "entities_with_active_claim": 1,
    "entities_with_outstanding_wake": 0,
    "entities_with_pending_work": 2
  },
  "health": {
    "status": "healthy",
    "issues": []
  }
}
```

**Health status derivation rules:**

| Condition                                       | Status      |
| ----------------------------------------------- | ----------- |
| Lease expired (liveness_lease_expires_at < now) | `unhealthy` |
| admin_status is `disabled`                      | `unhealthy` |
| Client reports stream_connected = false         | `degraded`  |
| Client reports last_heartbeat_ok = false        | `degraded`  |
| reconnect_count > 5 (since last check)          | `degraded`  |
| No client diagnostics available                 | `degraded`  |
| Otherwise                                       | `healthy`   |

Each failing condition adds a human-readable string to the `issues` array.

### Data Sources for the Endpoint

| Section    | Source                                                                |
| ---------- | --------------------------------------------------------------------- |
| `runner`   | `runners` table row                                                   |
| `client`   | `runners.diagnostics` JSONB (from last heartbeat)                     |
| `claims`   | `consumer_claims` table where `runner_id = :id AND status = 'active'` |
| `dispatch` | `entity_dispatch_state` table where `active_runner_id = :id`          |
| `health`   | Derived from above                                                    |

### Files Changed

**New:**

- `packages/agents-server/drizzle/0007_runner_diagnostics_and_principal.sql` — adds `diagnostics` JSONB column, renames `owner_user_id` → `owner_principal` on runners table

**Modified:**

- `packages/agents-runtime/src/pull-wake-runner.ts` — add diagnostics tracking, `getHealth()` method, report diagnostics in heartbeat
- `packages/agents-server/src/db/schema.ts` — rename `ownerUserId` → `ownerPrincipal`, add `diagnostics` column
- `packages/agents-server/src/entity-registry.ts` — rename `ownerUserId` params → `ownerPrincipal`; extend `heartbeatRunner` to store diagnostics; add `getActiveClaimsForRunner` and `getDispatchStatsForRunner` queries
- `packages/agents-server/src/electric-agents-types.ts` — rename `owner_user_id` → `owner_principal` on `ElectricAgentsRunner`, add `diagnostics` field, add health response types
- `packages/agents-server/src/routing/runners-router.ts` — rename all `owner_user_id` references → `owner_principal`; switch auth checks to use `ctx.principal.url`; add `GET /:id/health` route; extend heartbeat body schema with optional `diagnostics`
- `packages/agents/src/server.ts` — update `BuiltinAgentsServer` registration to use `ownerPrincipal`
- `packages/agents-desktop/src/main.ts` — update runner registration to use `owner_principal`

### Testing

- Unit test for health status derivation logic (pure function)
- Unit test for `getHealth()` on the PullWakeRunner
- Integration test extending the existing `horton-pull-wake-e2e.test.ts` to call the health endpoint after dispatch and verify diagnostics are populated
