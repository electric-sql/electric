# Pull-wake RFC sitrep and recent implementation diary

## What’s left for the RFC

### Likely remaining for a real v1

1. **Runner app integration**
   - Implement/verify the actual local runner loop:
     - tail runner wake stream
     - acquire via callback-forward
     - process entity
     - heartbeat
     - release/done with acked source offsets
   - Wire this into the desktop/Electron runner experience.

2. **End-to-end integration test**
   - Real-ish path:
     - register runner
     - spawn entity with runner `dispatch_policy`
     - append entity event
     - wake lands on runner wake stream
     - runner acquires
     - runner processes/done
     - pending/coalesced follow-up works
   - Current coverage is strong focused unit/route coverage, but not yet a full e2e/conformance test.

3. **Periodic recovery policy**
   - We added:
     - `expireStaleActiveClaims`
     - `recoverExpiredDispatchClaimsOnce`
   - Still left:
     - decide which server component runs it
     - interval/backoff config
     - observability/logging around recovered claims
   - No default interval is enabled yet, intentionally.

4. **Outstanding wake recovery**
   - We handle active-claim expiry.
   - Still worth deciding:
     - what happens if `outstandingWakeId` exists but runner never claims?
     - should queued/delivered-but-unclaimed wakes be retried after some age?
     - should disabled/offline runner state affect outstanding wakes?

5. **Entity stopped / superseded semantics**
   - RFC says stopped entities should reject/ignore claims and clear/supersede unresolved wake state.
   - Some stopped-entity guards exist, but full dispatch-state cleanup/supersede behavior still needs a pass.

6. **Runner UI / observability**
   - Data is now in Postgres for:
     - runners
     - entity dispatch state
     - wake notifications
     - consumer claims
   - Still left:
     - dashboard views
     - active/pending/recovered status display
     - runner liveness/activity visualization

7. **Docs cleanup**
   - RFC now reflects many decisions, but it still has “still open” language around state transitions/reaper that should be updated to distinguish:
     - implemented scaffold
     - production policy still future
   - `todo.md` should probably be converted from “decision TODO” into:
     - completed decisions
     - v1 remaining checklist
     - post-v1 backlog

### Explicitly still future / not v1

- worker pools
- multi-target / ordered fallback dispatch
- sandbox ↔ laptop handoff
- custom runner keypair/device credentials
- broad users/orgs/policy auth model
- wake stream compaction/retention
- production hardening like wake stream encryption/delegated credentials

## Diary: recent pull-wake implementation work

Today’s work turned the pull-wake RFC from mostly control-plane scaffolding into a coherent first pass of the runner dispatch path.

We started by getting the workspace healthy again. `pnpm install` was already consistent with the lockfile, then the prerequisite TypeScript client build unblocked the agents packages. After that, `agents-runtime` and `agents-server` both built and typechecked cleanly. Root `pnpm build` was confirmed not to be the right command for this repo because there is no root build script.

The first major focus was the local-runner safety gate. We locked down the invariant that runner-targeted work cannot be spawned or acquired by the wrong user when an `authenticateRequest` hook is configured. Runner registration now binds ownership to the authenticated user, rejects mismatched supplied owner ids, and rejects attempts to re-register another user’s runner. Runner-target spawn checks that the authenticated user owns the enabled runner. Callback-forward acquire checks both ownership and the supplied `Electric-Runner-Id` / `X-Runner-Id`, and it rewrites `Electric-Claim-Token` to upstream `Authorization` only after that gate passes.

Next, we built out the dispatch materialization model. `entity_dispatch_state` became the authority for duplicate suppression: if an entity already has an outstanding wake or active claim, new app-visible appends are coalesced into pending source offsets instead of dispatching another wake. Wake notifications are materialized as redacted rows, deliberately excluding raw callback URLs, claim tokens, wake write tokens, and entity write tokens. Runner dispatch now resolves the stored runner row and uses its stored `wake_stream` instead of deriving paths blindly.

After that, append-to-dispatch wiring went in for entities with explicit/stored `dispatch_policy`. This was intentionally narrow: no `serve_endpoint` fallback, no old endpoint translation, no shared-state dispatch, and no worker-pool execution yet. Successful entity appends now mint a wake notification, rewrite the callback through Agents Server callback-forward, materialize dispatch state, and either post to webhook or append to the runner wake stream. Dispatch failures are logged and do not fail the append response.

The next correctness issue was coalesced pending work. Previously, if an active runner was processing an entity and more appends arrived, we could record pending offsets but had no safe release-time drain. We added ack subtraction: when a runner sends `done`, acknowledged source offsets clear covered pending entries, while unacknowledged or ahead-of-ack entries remain. If pending work remains after release, the server fires a follow-up dispatch for entities with `dispatch_policy`.

Runner management was then tightened. With `authenticateRequest` configured, runner list/get/heartbeat/enable/disable routes are now owner-gated. Listing returns only the caller’s runners, mismatched owner queries are rejected, and non-owners cannot inspect, heartbeat, enable, or disable someone else’s runner. Without an auth hook, the routes remain scaffold-only for local development.

Finally, we added expired active-claim recovery. If a runner crashes or stops heartbeating, the materialized active claim should not suppress dispatch forever. The registry now has `expireStaleActiveClaims`, which clears expired active claim fields, marks matching consumer claims as `expired`, and returns pending work for recovery. The server exposes `recoverExpiredDispatchClaimsOnce`, a one-shot helper that redispatches pending work for recovered entities with `dispatch_policy`. We intentionally did not add a default background interval yet; production scheduling policy remains a follow-up decision.

The focused server suite is green: route tests, callback-forward auth tests, dispatch router tests, server-start tests, and registry helper tests all pass. Agents Server typecheck and build pass. The remaining work is less about the core data model and more about end-to-end runner integration, recovery scheduling, and production/UI polish.
