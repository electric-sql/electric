# Engineering diary — pull-wake runners PR

Dear diary,

Today this PR crossed the line from “RFC sketch with scattered scaffolding” into “real control-plane foundation with a minimum safety invariant.”

The big shape of the work is now clear:

> This PR is not yet full end-to-end pull-wake dispatch, but it now contains the schema, runtime plumbing, callback materialization, runner registration, dispatch-policy storage, and the urgent local-runner owner gate needed before wiring actual wake delivery.

### Where we started

At the beginning of this run, the branch already had earlier pull-wake slices applied. The basic direction was:

- model runners and dispatch policies,
- reuse the existing webhook wake notification shape for pull-wake,
- let local runners receive `WakeNotification`s from wake streams,
- preserve the Durable Streams claim protocol,
- keep Postgres as the synced/control-plane materialization layer.

But several parts were still loose:

- claim token transport was hard-coded to `Authorization`,
- callbacks/claim tokens weren’t consistently treated as sensitive,
- dispatch policy parsing/inheritance wasn’t fully wired,
- callback materialization was not safe against stale releases,
- runner registration/liveness did not exist yet,
- and, most importantly, local-runner auth was initially deferred too broadly.

### The core thing we added

The branch now has the main control-plane vocabulary:

- `DispatchPolicy`
- `DispatchTarget`
- `WakeNotification`
- `PublicWakeNotification`
- `ElectricAgentsRunner`
- `EntityDispatchState`
- `WakeNotificationRow`
- `ConsumerClaim`
- `AuthenticateRequest`

The model is now much closer to the RFC:

```ts
type DispatchPolicy = {
  targets: [DispatchTarget, ...DispatchTarget[]]
}

type DispatchTarget =
  | { type: 'webhook'; url: string }
  | { type: 'runner'; runnerId: string }
  | { type: 'worker-pool'; workerPoolId: string } // rejected for v1
```

V1 validates exactly one target. `worker-pool` remains future work.

### Runtime progress

The runtime now supports the local-runner two-header claim flow.

Before, runtime claim/heartbeat/done callbacks always used:

```http
Authorization: Bearer <claimToken>
```

Now `processWake` supports:

```ts
claimHeaders?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
claimTokenHeader?: 'authorization' | 'electric-claim-token' | 'both'
```

So local runners can do:

```ts
processWake(notification, {
  baseUrl,
  claimHeaders: () => ({
    authorization: `Bearer ${userSessionToken}`,
  }),
  claimTokenHeader: 'electric-claim-token',
})
```

Which sends:

```http
Authorization: Bearer <user/session token>
Electric-Claim-Token: <durable streams claim token>
```

That matters because local-runner acquire needs both:

1. user/session auth for Agents Server, and
2. Durable Streams claim token for the consumer mutex.

The runtime still preserves webhook compatibility by defaulting to the old `Authorization: Bearer <claimToken>` behavior.

### Server schema/control-plane progress

The server now has the pull-wake control-plane tables scaffolded:

- `users`
- `runners`
- `entity_dispatch_state`
- `wake_notifications`
- `consumer_claims`

And the existing tables were extended:

- `entity_types.default_dispatch_policy`
- `entities.dispatch_policy`

The migration also now backfills `entity_dispatch_state` for existing entities:

```sql
INSERT INTO entity_dispatch_state (entity_url)
SELECT url FROM entities
ON CONFLICT (entity_url) DO NOTHING;
```

And `runners.wake_stream` is unique.

Electric shape proxy allowlists were updated so UI/sync can safely read the new control-plane tables without exposing raw secrets:

- no `entities.write_token`
- no raw `claimToken`
- `wake_notifications` exposes `notification_public`
- sensitive user metadata/auth linkage is excluded for now

### Dispatch policy progress

Dispatch policy now flows through:

- entity type registration,
- entity type amend,
- public spawn,
- entity rows,
- public entity projection,
- Electric shape proxy column allowlist.

Spawn effective dispatch policy resolution is now:

1. explicit `dispatch_policy`
2. parent entity `dispatch_policy`
3. entity type `default_dispatch_policy`

The child inheritance decision is intentional. Children inherit parent dispatch policy unless explicitly overridden.

That lets a tree of work stay pinned to the same runner by default.

### Callback-forward progress

Callback-forward got a lot more real.

It now:

- preserves callback forwarding compatibility,
- supports `Electric-Claim-Token` by translating it upstream to Durable Streams `Authorization`,
- injects entity `writeToken` into successful claim responses as before,
- materializes successful active claims,
- materializes heartbeats,
- materializes releases,
- avoids corrupting active state on stale `done`.

The stale release fix was important.

Previously, a delayed `done` from an old epoch could clear a newer active claim and mark the entity idle. Now release materialization only clears active state if the claim id / callback id still matches the current active claim.

### Local-runner auth gate

This became urgent.

Even though broader spawn/acquire auth is still a future design exercise, local runners needed a minimal owner gate now because otherwise one user could target work at another user’s personal machine.

With `authenticateRequest` configured:

- runner registration requires an authenticated user,
- supplied `owner_user_id` must match the authenticated user,
- re-registering an existing runner owned by someone else is rejected,
- spawning an entity to a runner target requires the authenticated user to own the enabled runner,
- callback-forward acquire for a runner target requires:
  - authenticated user owns the runner,
  - request identifies the runner via `Electric-Runner-Id` / `X-Runner-Id`,
  - runner id matches the entity’s dispatch policy.

This is deliberately narrow. It is not a general auth/policy framework. It is just the safety invariant needed for local runners.

### Redaction progress

We now treat wake/callback material as sensitive in the database and public shapes.

Raw callback URL, raw claim token, wake write token, and entity write token do not go into `notification_public`.

The public wake notification keeps enough data for UI/debugging without granting execution authority.

### What is still not done from this point

1. **Actual append → dispatch wiring**
   - app-visible entity appends do not yet mint and deliver a wake to a runner stream.

2. **Dispatch router**
   - the intended path is:
     - coalesce in `entity_dispatch_state`,
     - materialize `wake_notifications`,
     - rewrite callback through Agents Server,
     - deliver to webhook or runner wake stream.

3. **Runner dispatch state machine**
   - outstanding wake,
   - active claim,
   - pending source offsets,
   - stale/expired states.

4. **Runner management auth**
   - list/get/heartbeat/enable/disable still need owner gating.

5. **Outstanding wake / active claim recovery**
   - reaper is not implemented yet.

6. **Stopped / terminal entity handling**
   - claims and dispatch should be rejected or superseded for stopped states.

7. **Recovery/reaper**
   - expired active claims,
   - outstanding wakes that never get claimed,
   - pending source offsets with no active lease.

8. **Tests**
   - dispatch policy validation,
   - runner registration,
   - local-runner auth gate,
   - callback two-header behavior,
   - stale release protection,
   - redaction,
   - runner disabled/nonexistent cases.

### Known risks / caveats

- Runner management routes are still scaffold-level. The urgent spawn/acquire safety gate is in place, but list/heartbeat/enable/disable auth still needs tightening.
- Custom `wake_stream` is allowed at registration. That is okay for scaffold/dev, but before real dispatch we should restrict or authorize it carefully.
- Wake stream entries contain raw claim tokens because runners need them. That means wake stream access boundaries matter.
- Typecheck/build has not been clean yet due missing or mismatched local deps.
- The build/setup worker is currently running `pnpm install` and `pnpm build`; no result yet.
- The Durable Streams wake-notification mint endpoint still needs validation against the actual DS implementation.

### Current status in one sentence

The branch now has the **data model, runtime token transport, runner registration/liveness scaffold, callback materialization, dispatch-policy ingestion/inheritance, redaction, and minimum local-runner owner safety gate**, but it does **not yet wire actual app-visible entity appends into runner wake delivery**.

### My recommended next move

Wait for the build worker.

Then:

1. Fix any TypeScript/build errors.
2. Add a small test suite around the new safety gate and callback materialization.
3. Only after that, wire dispatch router behind a carefully transactional path:
   - coalesce first,
   - materialize `wake_notifications`,
   - rewrite callback through Agents Server,
   - use stored runner row/wake stream,
   - append/post notification.

That’s the line between “safe scaffold” and “real pull-wake execution path.”
