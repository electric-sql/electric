# Engineering diary — pull-wake post-merge, write-token security, and desktop plan

Dear diary,

Today’s pull-wake work moved from “server-side control plane mostly exists” into the harder integration phase: merging current `origin/main`, reconciling new claim-scoped write-token behavior, tightening the security model, and planning the desktop migration.

## Starting point

The branch already had the pull-wake control-plane slices in place:

- runner registration and liveness scaffold,
- dispatch policies on entity types/entities,
- runner-target append dispatch,
- callback-forward acquire/done materialization,
- coalesced pending source offsets,
- stale active claim recovery,
- stale outstanding wake recovery,
- stopped-entity dispatch supersede cleanup,
- periodic recovery scheduling behind opt-in config,
- and several focused tests around these behaviors.

The immediate next goal was to prepare for real manual testing with the desktop app.

## Periodic recovery scheduling

A worker added an optional background dispatch recovery loop to `ElectricAgentsServer`.

New options/env:

- `dispatchRecoveryIntervalMs`
- `staleOutstandingWakeAfterMs`
- `ELECTRIC_AGENTS_DISPATCH_RECOVERY_INTERVAL_MS`
- `ELECTRIC_AGENTS_STALE_OUTSTANDING_WAKE_AFTER_MS`

The loop is disabled by default. When enabled, each tick calls:

- `recoverExpiredDispatchClaimsOnce({ now })`
- `recoverStaleOutstandingWakesOnce({ now, staleBefore })`

The first review found an important lifecycle bug: `stop()` cleared future intervals but did not await an in-flight recovery tick, so recovery could continue while DB/server resources were shutting down.

A follow-up fixed this by tracking the active recovery promise and making shutdown:

1. mark the server as shutting down,
2. clear the interval,
3. await the active recovery promise,
4. then close resources.

Tests were added for disabled-by-default behavior, enabled scheduling, no overlapping runs, and shutdown waiting for an active recovery run. Review passed.

## Public append/request-path coverage

A prior runner dispatch test was useful but called the private helper:

```ts
;(server as any).dispatchWakeForEntityAppend(entity, event)
```

That proved dispatch router wiring but not the real append request path. A worker added request/response helpers in `server-start.test.ts` and tested actual server request handling:

- positive case:
  - `POST /chat/public-append/main`,
  - upstream Durable Streams append held pending,
  - no runner dispatch before upstream success,
  - upstream resolves `201`,
  - runner wake is appended.
- negative case:
  - upstream returns `500`,
  - no wake mint/materialize/runner append happens.

A review asked for stronger assertions and safer mock cleanup. Follow-up hardening added `try/finally` around `globalThis.fetch` spy restore and pre-upstream-success assertions that no wake mint, no `beginDispatchWake`, no runner lookup, and no runner wake append had started.

## Merge from `origin/main`

The desktop work had landed on `origin/main`, so we merged it into the pull-wake branch.

The merge was done by stashing local WIP, fast-forwarding to `origin/main`, and popping the stash. Conflicts appeared in:

- `packages/agents-server/src/electric-agents-routes.ts`
- `packages/agents-server/src/server.ts`

A conflict-resolution worker preserved both sides.

From `origin/main`:

- `RuntimeRegistry`,
- active claim write-token tracking,
- entity-kill cleanup for active claims,
- desktop/runtime-registry support.

From pull-wake:

- runner routes and auth gates,
- dispatch wake router,
- recovery loop,
- callback-forward materialization,
- pending follow-up dispatch.

Initial review after conflict resolution found no conflict markers but several focused test failures. These exposed real integration issues between the newly merged claim-scoped write-token work and pull-wake.

## Claim-scoped write tokens vs entity write tokens

The first post-merge fix attempted a compromise:

```ts
if (activeClaim) return activeClaim.token === token
return token === entityWriteToken
```

That meant the long-lived entity write token worked whenever no active claim existed.

A security review rejected this compromise. The existing `origin/main` tests expected claim-scoped exclusivity, and allowing entity tokens during or around claims weakens the model.

Then the design was clarified explicitly: **entity write tokens should not be public write auth at all**.

The intended model is now:

- no public persistent entity write token,
- no `x-write-token` on spawn,
- no `writeToken` / `entity.writeToken` in wake payloads,
- public/entity stream writes require a claim-scoped token returned by successful acquire,
- initial/user-originated writes are server-mediated after server auth/authz,
- tests should claim the stream normally and write with the claim-scoped token,
- no backwards compatibility with entity-token writes.

This is intentionally stricter. A separate entity write token is a security disaster waiting to happen because it creates a second long-lived authority path that can bypass the claim mutex.

## Process-local claim tokens decision

A review also pointed out that claim write-token validation was process-local:

```txt
activeClaimWriteTokens
activeClaimWriteTokensByConsumer
```

A more durable design would persist hashed token state and validate through a read-through cache. However, for v1 we decided **not** to persist claim write tokens.

The decision:

- claim write tokens are short-lived process-local ephemeral capabilities,
- they are returned only from successful acquire,
- if the server restarts or loses memory, old claim write tokens fail closed,
- runtimes must reacquire/refresh claims when writes fail,
- this avoids a Postgres lookup on the hot write path,
- wakes are expected to be short enough that restart/reacquire is acceptable.

The docs were updated to record this.

## Implementing the no-entity-write-token model

A worker implemented the clarified model.

Changed behavior:

- public/entity stream writes now require active claim-scoped write tokens,
- stored `entity.write_token` is not accepted as fallback authorization,
- spawn no longer exposes `x-write-token`,
- runner wake payload entity context no longer includes `entity.writeToken`,
- callback-forward claim still mints and returns a fresh claim-scoped `writeToken` after successful acquire.

Tests updated:

- `server-claim-write-token.test.ts`
  - entity write token rejected before any claim,
  - entity write token rejected after release,
  - claim token works only while active,
  - stale tokens fail.
- `electric-agents-routes.test.ts`
  - spawn no longer expects `x-write-token`.
- `server-start.test.ts`
  - public append tests seed/use claim-scoped tokens,
  - runner wake payload no longer expects entity write token.

Focused tests passed for claim write tokens, callback-forward auth, runner routes, server start, and dispatch router coverage.

## Red/green on docs and implementation

The first red/green pass came back RED because wake payloads could still carry a top-level `writeToken`.

Even though public/materialized wake rows redacted it, actual delivery sent the raw notification to webhook/runner targets. Tests still mocked and expected:

```ts
writeToken: 'wake-write-secret'
```

That contradicted the new docs: the claim-scoped `writeToken` belongs only in the successful acquire response, not in the initial wake notification.

A follow-up removed the fields from wake payload types and delivery:

- removed `WakeNotification.writeToken`,
- removed `WakeNotification.entity.writeToken`,
- added defensive stripping in `DispatchWakeRouter`,
- delivery to webhook/runner strips token fields,
- tests assert delivered runner wake payloads do not contain top-level or entity `writeToken`,
- legacy redaction tests still cast extra fields to verify defensive stripping.

The next red/green pass was GREEN.

Confirmed:

- no `x-write-token` source exposure,
- public entity responses are redacted,
- runner wake notifications do not include entity/write tokens,
- public/materialized wake notifications redact secrets,
- entity write token is not accepted for public server writes,
- claim-scoped token works and rotates,
- runner-target acquire gate remains present,
- `Electric-Claim-Token` forwarding works.

Remaining caveat, accepted for v1:

- claim write tokens are process-local/in-memory and fail closed across restarts.

## Docs updated

The RFC and TODO were updated:

- `docs/rfcs/2026-05-05-pull-wake-runners-registration.md`
- `todo.md`

They now state:

- persistent entity write tokens are internal server-side secrets, not public write auth,
- wake notifications must not include `writeToken` / `entity.writeToken`,
- public/entity stream writes require claim-scoped tokens returned by acquire,
- initial/user-originated writes are server-mediated after normal server auth/authz,
- claim write tokens are process-local ephemeral v1 capabilities,
- server restart/token loss fails closed,
- runtimes should reacquire/refresh claims,
- no hot-path Postgres lookup per write,
- no backwards compatibility requirement for entity-token writes.

## Desktop arrives from main

After merging `origin/main`, the desktop package exists at:

- `packages/agents-desktop/src/main.ts`
- `packages/agents-desktop/package.json`

But investigation showed the desktop is still webhook/local-server oriented.

It currently starts `BuiltinAgentsServer`, which:

- creates a local HTTP server,
- computes a `serveEndpoint`,
- registers built-in Horton/worker types,
- registers webhook subscriptions,
- handles `POST /_electric/builtin-agent-handler`.

So the desktop cannot yet run the intended pull-wake two-account manual test.

## Desktop testing target

The desired manual acceptance test is:

- run two desktop app instances,
- each logged in/asserted as a different user,
- each with a distinct local runner id,
- each creates entities with explicit dispatch policy targeting itself,
- runner wakes go only to the owning desktop,
- cross-user runner targeting/acquire is rejected.

User clarified several design decisions:

1. Build a **general pull-wake runner library** that desktop consumes.
2. Remove webhook setup entirely for the new path; do not preserve legacy/dev webhook compatibility for built-in desktop flow.
3. Registration should generally happen elsewhere, e.g. CI/app setup. For local testing, optional registration is fine.
4. Horton should **not** have a default dispatch policy. Each desktop creates new entities with explicit dispatch policy targeting its own runner.
5. Local dev auth can be asserted through env/user headers, e.g. name/email.

## Planned pull-wake runner library

A planning worker proposed adding a general runner helper to `agents-runtime`:

```txt
packages/agents-runtime/src/pull-wake-runner.ts
```

Proposed API:

```ts
createPullWakeRunner({
  baseUrl,
  runnerId,
  label,
  runtime,
  registerRunner,
  ownerUserId,
  headers,
  pollIntervalMs,
  longPollTimeoutMs,
  heartbeatIntervalMs,
  leaseMs,
  initialOffset,
  onOffset,
  onError,
})
```

Responsibilities:

- optionally register/upsert runner for local dev,
- heartbeat runner,
- tail `/runners/${runnerId}/wake`,
- parse wake notifications,
- call `runtime.dispatchWake(notification)`,
- persist offsets via callback,
- stop polling/heartbeat and wait for runtime settled.

Registration is optional because production desktop can inherit registrations created elsewhere.

## Planned removal of webhook setup

The user clarified: don’t keep webhook setup as legacy compatibility in this path. Remove it.

The next implementation worker was dispatched to:

1. add `createPullWakeRunner`,
2. export it,
3. remove/disable webhook subscription setup from runtime registration,
4. make registration type-only going forward,
5. not add Horton default dispatch policy.

That worker is currently running.

## Build/manual setup findings

Before manual testing, stale packages need rebuilding:

```sh
pnpm --filter @electric-ax/agents-runtime build
pnpm --filter @electric-ax/agents-server build
pnpm --filter @electric-ax/agents build
pnpm --filter @electric-ax/agents-server-ui build:desktop
pnpm --filter @electric-ax/agents-desktop build
```

Local services:

```sh
docker compose -f packages/agents-server/docker-compose.dev.yml up -d
```

Agents Server:

```sh
DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:5432/electric_agents \
ELECTRIC_URL=http://localhost:3060 \
ELECTRIC_AGENTS_PORT=4437 \
ELECTRIC_AGENTS_HOST=127.0.0.1 \
ELECTRIC_AGENTS_BASE_URL=http://localhost:4437 \
ELECTRIC_AGENTS_LOG_LEVEL=debug \
ELECTRIC_AGENTS_LOG_FILE=false \
pnpm --filter @electric-ax/agents-server start
```

Desktop:

```sh
pnpm --filter @electric-ax/agents-desktop dev
```

But this won’t prove pull-wake until the runner library and desktop pull-wake mode are wired.

## Current status

The branch now has a much stronger security model:

- no public entity write token,
- no write tokens in wake payloads,
- process-local claim-scoped write tokens only from acquire,
- fail-closed restart semantics,
- focused tests green for the write-token/wake-token security model.

The remaining path to manual desktop testing is now clear:

1. implement the general pull-wake runner library,
2. remove webhook setup from built-in runtime registration path,
3. wire built-in agents/desktop to the runner library,
4. add local dev asserted auth,
5. make desktop-created entities use explicit runner-target dispatch policy,
6. build all packages and run the two-desktop manual test.

That’s the next chapter.
