# Pull-Wake Runners RFC — Decision TODO

Tracking decisions and follow-up discussions for `docs/rfcs/2026-05-05-pull-wake-runners-registration.md`.

## Decisions made

- **Defer fallback dispatch for v1.**
  - Initial dispatch policy should target a single local runner or webhook.
  - Worker-pool targets are a later phase.
  - Ordered fallback / timeout-based expansion looks doable but is not needed for the first release.
  - Remove or clearly mark `fallbackTimeoutMs` / ordered fallback semantics as future work.

- **No sandbox → laptop handoff protocol in v1.**
  - If sandbox work should continue on laptop, use a fork / new entity flow rather than migrating an active claim and filesystem state.
  - Handoff of durable stream state is conceptually simple, but handoff of uncommitted files/artifacts is future work.
  - RFC should avoid implying seamless handoff unless progress is fully durable/shared.

- **Future worker pool wake streams use independent runner cursors.**
  - Worker pools are deferred, but when added their wake stream should be broadcast-style: every worker pool member can read the same wake events and race to claim.
  - Losing claim attempts are harmless because the consumer mutex returns `EPOCH_HELD` / equivalent.
  - Durable Streams does not currently have compaction; if/when compaction exists, local/server-visible runner cursors should be supported.

- **Use existing webhook notification metadata for pull-wake.**
  - The current payload already has IDs/correlation fields such as `wakeId`, `streams`, and `triggeredBy`.
  - Only add more dedupe/debug fields if the existing webhook payload is proven insufficient.

- **Reuse the existing callback/claim fields in wake notifications.**
  - The existing webhook notification includes `callback` and `claimToken`.
  - Pull-wake runners should use those fields directly instead of doing a lookup first.
  - The callback URL/token are not proof of authorization by themselves; acquire remains checked against authenticated user, runner ownership, dispatch target, and mutex state.

- **Split runner status fields.**
  - Replace single mixed `status` enum with separate concepts:
    - stored `adminStatus`: `enabled | disabled`
    - derived `liveness`: `online | offline`, from heartbeat lease
    - derived `activity`: `idle | busy`, from active claims/capacity

- **Remove runner public/private keypair design.**
  - Runner identity remains a control-plane object.
  - Authentication should use regular auth/session/device auth instead of a custom runner keypair protocol.
  - Acquire should verify the authenticated caller is allowed to act as the runner.

- **Use agent servers as the scope in this RFC.**
  - Use agent servers as the scope for registrations, runners, worker pools, and dispatch configuration.
  - Rework paths and data models around the current agent server.

- **Do not invent a generic policy/update/versioning model for registrations.**
  - Remove made-up `creationPolicy`, `writePolicy`, `claimPolicy`, `updatePolicy`, and registration version fields from the RFC.
  - Authorization should be described in terms of existing auth, runner status, dispatch target matching, runner ownership, and consumer mutex state.
  - Local runner update policy is out of scope; each runner app decides how it updates itself and any bundled code.
  - The Electron app with Horton can distribute new app versions for updates.

- **The control plane does not control how runners work.**
  - Registrations are control-plane metadata for routing/discovery, not runner execution specs.
  - Do not put code references, install/build/run commands, subprocess supervision, hot reload, or app update policy in server-side registration.
  - Once a runner acquires an entity stream, the runner app decides how to handle that entity type.
  - Hot reload should use Unix-style `SIGHUP`, not a made-up `code_updated` signal.

- **Broad spawn/acquire auth is deferred, but this PR includes a minimal local-runner owner safety gate.**
  - Do not design full users/orgs/policy in this PR.
  - Add a host-provided `authenticateRequest(req) -> { userId } | null` hook.
  - Runner registration uses the authenticated user as `ownerUserId` when the hook is configured and rejects mismatched supplied `owner_user_id`.
  - Runner-target spawn/acquire require the authenticated user to own the enabled target runner; webhook-only flows do not require auth.
  - Callback-forward acquire for runner targets also requires `Electric-Runner-Id` or `X-Runner-Id` to match the entity's target runner.
  - Future auth design still needs to cover: user entity/record provisioning, org/team policy, richer spawn authorization, delegated device credentials, capacity, and host-app/Cloud integration.

- **Do not include non-OSS production routing or backwards-compatibility migration questions in the RFC.**
  - Routing storage in production is an Electric Cloud/production concern, not an OSS RFC question.
  - Backwards compatibility with the current schema is not a requirement for this RFC.

- **Dispatch policy keeps room for multiple targets, but v1 allows exactly one.**
  - Keep the dispatch policy shape target-list-friendly.
  - Temporarily restrict each entity to one target for the initial local-runner milestone.
  - Ordered fallback / multiple targets remain future work.

- **Entity identity is the path, not a separate `entityId`.**
  - Wake payloads should use the existing entity path / stream path identity.
  - Do not add a redundant `entityId` field.

- **Pull-wake should reuse the existing webhook notification payload.**
  - Do not invent a separate dispatch wake event shape unless the existing webhook payload is insufficient.
  - Runner implementation should not need metadata beyond what webhook runners already receive.

- **Worker pools move to a later phase.**
  - Initial goal is local runners.
  - Worker-pool records, shared wake streams, capacity, and pool membership can be designed after local runner support lands.

- **Registration is just entity information.**
  - Registration/entity type metadata should describe the entity and stream layout.
  - It is not a runner execution spec and does not need a separate unclear abstraction for v1.

- **Paths are accepted.**
  - Root stream paths and the reserved `_electric` control prefix are good.

- **UI work can come later if the data is in Postgres.**
  - Capture runner status, wake notifications, claims, and relevant derived-state inputs in Postgres.
  - UI can sync these tables/shapes via Electric later.

- **Consistent entity dispatch state solves duplicate wakes.**
  - Entity state should know whether there is an outstanding wake or active claim.
  - The wake router can use that state to coalesce/suppress duplicate actionable events deterministically.

- **Expired active-claim recovery is scaffolded as a callable helper.**
  - The registry can expire stale active claim materialization and return entities with pending source streams for follow-up dispatch.
  - The server has a one-shot helper to re-dispatch those pending items when the entity still has a dispatch policy.
  - A periodic production policy/interval is still future work and is not enabled by default.

- **Do not support changing an entity's dispatch policy in v1.**
  - Dispatch policy is fixed at spawn.
  - Fork/spawn a new entity with a different dispatch policy as the workaround.
  - Active handoff / dispatch-policy migration can be tackled later if needed.

- **Webhook notification should become a generic wake notification.**
  - The current `WebhookNotification` type should be renamed/generalized, e.g. to `WakeNotification`.
  - What gets sent to webhooks is exactly what should be appended to runner wake streams.
  - Keep the notifications identical unless a concrete reason to diverge is found.

- **Authenticated as user is enough for local runners in v1.**
  - A runner authenticated as the owning user can act as that user's runner.
  - Runner-specific cryptography/device credentials remain deferred.

- **Runner heartbeat/liveness should copy claim heartbeat/liveness semantics.**
  - Runner liveness should be lease/heartbeat based.
  - Missed heartbeats mark the runner offline.
  - Use the same style of timing/recovery rules as active claims.

- **Durable Streams is responsible for all consumers / consumer mutexes.**
  - Consumer mutex remains the ultimate source of truth for active claims.
  - It must distinguish near-simultaneous acquire requests.
  - Once acquire/heartbeat/release is decided, it should immediately update Postgres so claim state is backed up and synced.
  - `entity_dispatch_state` is also important for UI: if a runner crashes, the UI cannot reliably infer that from the entity stream alone; it needs synced dispatch/claim/liveness materialization.

- **Wake stream entries literally store the generic `WakeNotification`.**
  - The notification is not large enough to justify a separate transport envelope in v1.
  - Existing `wakeId`, `streams`, and `triggeredBy` are fine for dedupe/debug for now.

- **A user can have multiple runners.**
  - Multiple local runners owned by the same user should show up in the UI.

- **Registration/entity info is the current entity type metadata minus webhook info.**
  - Keep entity schemas, description, revision, etc.
  - Move webhook delivery info into `dispatchPolicy` / `defaultDispatchPolicy`.

- **Built-in Horton/Worker are unrelated to this control-plane change.**
  - They can ship with the Electron app and run under that app's local runner.

- **User entity is built-in but extendable.**
  - Provide default user fields.
  - Specific agent servers can extend/profile users as needed.
  - Do not over-design this yet; it will change quickly.

- **Durable Streams should mint claimable `WakeNotification`s on demand.**
  - Agents Server calls a Durable Streams API to create a claimable notification with signed callback URL, claim token, epoch, wake id, and stream offsets.
  - Webhooks, pull-wake, and future notification standards should all use this path.
  - Agents Server enriches and dispatches the notification; it does not hand-roll claim tokens.

- **Use two headers for runner acquire: user auth plus claim token.**
  - Local runners call Agents Server with normal user authentication in `Authorization`.
  - The Durable Streams claim token travels separately in `Electric-Claim-Token`.
  - Agents Server verifies user/runner ownership and then forwards to Durable Streams using the claim token as Durable Streams expects.
  - Do not overload `Authorization` with the claim token in local-runner flows.

- **Do not persist raw claim/write tokens in synced Postgres materialization.**
  - Runner wake stream entries contain the claim token because the runner needs it to claim.
  - `wake_notifications` / UI projections should redact claim tokens and any write tokens; wake payloads should not include `writeToken` or `entity.writeToken`.
  - Any entity-row write secret is internal server-side state only; claim tokens are not currently stored by Agents Server.

- **Set `running` only after successful acquire.**
  - Tighten status transitions so an entity becomes `running` when the consumer mutex grants a claim, not merely when a notification is delivered.

- **Existing `WakeRegistry` is not the new dispatch router.**
  - Current `wakeRegistry` manages entity-to-entity observation wakes / `wake_registrations`.
  - The new dispatch wake router should be named/separated to avoid confusion.
  - Use a name like `DispatchWakeRouter` or `NotificationRouter`; do not reuse `WakeRegistry`.

- **Children inherit parent dispatch policy by default.**
  - `ctx.spawn` / child creation should inherit the parent's `dispatchPolicy` unless explicitly overridden.
  - This allows overriding for fan-out to cloud runners later.

- **Dispatch triggers are all app-visible entity stream appends.**
  - For v1, every app-visible append to an entity stream is actionable.
  - Internal control-plane bookkeeping such as claim heartbeat, consumer ack, dispatch materialization, and wake notification debug rows must not recursively trigger dispatch wakes.

- **No public entity write tokens; claim write tokens are process-local capabilities.**
  - Persistent entity write tokens are internal server-side secrets, not public write auth, and must not be exposed in wake payloads, synced projections, or debug tables.
  - Public/entity stream writes after a runner claims work require the claim-scoped write token returned by successful claim/acquire.
  - Initial/user-originated writes are server-mediated after normal server authentication/authorization, not by handing out entity write tokens.
  - Claim write tokens are process-local ephemeral capabilities for v1; do not persist, hash, or materialize them to Postgres.
  - Server restart/token loss fails closed; runtimes should reacquire or refresh claims before continuing writes.
  - This avoids a hot-path Postgres lookup for each write.
  - There is no backwards compatibility requirement for entity-token writes.

## V1 scope proposal

Keep v1 focused on:

1. First-class runner records.
2. Local runner wake streams.
3. Pull-wake loop.
4. Single-target dispatch per entity, using a shape that can later support multiple targets.
5. Registration separated from webhook subscription mechanics.
6. Existing consumer mutex claim protocol as the execution ownership gate.
7. Control-plane scaffolding for future authenticated-user flow plus minimal same-owner safety checks for runner registration, runner-target spawn/acquire, and runner management routes when an auth hook is configured.
8. Observability for runner liveness, active claims, and derived pending-work state.

Explicitly defer:

- Ordered fallback dispatch.
- Timeout-based fallback routing.
- Worker pools, shared worker-pool wake streams, membership, and capacity.
- Sandbox/laptop handoff of active work or filesystem artifacts.
- Stream compaction.
- Separate multi-tenant namespace model.
- Custom runner keypair auth.
- Runner implementation details such as code distribution, install/build/run commands, subprocess supervision, hot reload, and app updates.

## Design questions to discuss

### Dispatch model

Decided:

- Keep a dispatch-policy shape that can support multiple targets later.
- V1 allows exactly one target per entity.
- Dispatch policy is stored per entity at spawn time; registration/entity type can provide the default.

Decided:

- Do not allow changing an entity's dispatch policy after spawn in v1.
- Fork/spawn a new entity with a different dispatch policy instead.
- Consistent entity dispatch state tracks outstanding wakes/active claims and is used to coalesce or suppress duplicate actionable events.

### Entity state and recovery

Decided:

- Keep consistent entity dispatch state in Postgres.
- Entity dispatch state should record enough to know whether there is an outstanding wake or active claim.
- That state is what lets the wake router coalesce/suppress duplicate wakes.
- Entity DB status should use the existing values: `spawning | running | idle | stopped`.
- Do not add `pending_dispatch` as a new entity status; treat pending work / failed latest run as derived UI state.

Still open:

- Exact Postgres fields / state transitions for entity dispatch state.
- Consumer mutex is the ultimate source of truth for active claim ownership because it must resolve near-simultaneous acquire requests.
- Postgres should be updated immediately after mutex acquire/heartbeat/release decisions so state is durable, queryable, and synced.
- "Offsets" here means source/entity stream offsets carried by `WakeNotification.streams`, not wake-stream offsets. Wake-stream offsets are just runner cursors and are not the source of entity recovery truth.

Proposed state transitions:

- Entity spawned: insert `entities` + `entity_dispatch_state`; child entities inherit parent `dispatchPolicy` unless overridden.
- App-visible entity event appended: if no outstanding wake/active claim, ask Durable Streams to mint `WakeNotification`, write redacted `wake_notifications`, set outstanding wake, deliver notification.
- Duplicate app-visible event while wake outstanding or claim active: merge/update `pendingSourceStreams`; do not append another wake.
- Acquire accepted: consumer mutex grants lease; write `consumer_claims(active)` keyed by `(consumerId, epoch)`; clear outstanding wake; set active claim fields; set `entities.status = 'running'`.
- Acquire rejected: return conflict; no entity status change.
- Heartbeat: extend consumer lease and update `consumer_claims` + `entity_dispatch_state`.
- Release/done: mark claim released, clear active claim, set status back to `idle` unless stopped; if pending work remains, mint/queue another wake.
- Lease expiry: Durable Streams makes consumer claimable again; materializer/reaper marks claim expired, clears active claim, and requeues if pending work remains.
- Entity stopped: reject/ignore new claims, supersede unresolved wakes, clear active dispatch materialization as appropriate.

Still open:

- Validate/refine the proposed Postgres fields and state transitions for entity dispatch state.
- Which Agents Server component runs the Postgres materialization/recovery scan around Durable Streams lease expiry?
- Should the recovery scan look for:
  - entities with outstanding wake events that have not been claimed?
  - entities with expired active leases?
  - entities with unprocessed source/entity stream offsets and no active lease?

### Wake notification shape

Decision:

- Pull-wake should reuse the existing webhook notification payload.
- Rename/generalize the current `WebhookNotification` type, e.g. to `WakeNotification`.
- What gets sent to webhooks is exactly what should be appended to the wake stream unless a concrete divergence is discovered.
- There is no separate `entityId`; entity identity is the entity path / stream path.
- Runner implementation should not need metadata beyond what webhook runners already receive.

Current runtime-facing webhook notification shape in `packages/agents-runtime/src/types.ts`, to be generalized:

```ts
type WakeNotification = {
  consumerId: string
  epoch: number
  wakeId: string
  streamPath: string
  streams: Array<{ path: string; offset: string }>
  triggeredBy?: string[]
  callback: string
  claimToken: string
  triggerEvent?: string
  wakeEvent?: WakeEvent
  entity?: {
    type?: string
    status: string
    url: string
    streams: { main: string; error: string }
    tags?: Record<string, string>
    spawnArgs?: Record<string, unknown>
  }
}
```

Current handler-facing `WakeEvent` shape:

```ts
type WakeEvent = {
  source: string
  type: string
  fromOffset: number
  toOffset: number
  eventCount: number
  payload?: unknown
  summary?: string
  fullRef?: string
}
```

Decided:

- Wake stream entries literally store `WakeNotification`.
- Existing `wakeId`, `streams`, and `triggeredBy` are enough for dedupe/debug for now.
- Agents Server Postgres materialization should store only a redacted `notificationPublic`; raw claim/write tokens should not be synced to UI.

### Runner model

Candidate v1 shape:

```ts
type Runner = {
  id: string
  ownerUserId?: string // required for user-owned local runners

  label: string
  kind: 'local' | 'cloud-worker' | 'sandbox' | 'ci' | 'server'

  adminStatus: 'enabled' | 'disabled'
  liveness: 'online' | 'offline' // derived from heartbeat lease
  // activity is derived from active claims/capacity, not stored

  lastSeenAt?: string
  registeredAt: string

  activeClaims: Array<{
    entityPath: string
    consumerId: string
    claimedAt: string
    leaseExpiresAt?: string
  }>

  wakeStreams: string[]
}
```

Decided:

- For v1, authenticated-as-user + `ownerUserId` is enough to act as `runnerId`.
- Runner-specific cryptography/device credentials are deferred.
- Runner heartbeat/liveness should copy claim heartbeat/liveness semantics: lease-based heartbeat, missed heartbeat means offline.
- Team/shared runners are deferred with broader multi-user/multi-tenant design.

Still open:

- What is the exact auth/session mechanism for a local runner / desktop app?
- What heartbeat interval / lease duration should local runners use?

Decision:

- `activity` is not a stored field for now; derive it from active claims/capacity.

### Worker pools

Decision:

- Move worker pools to a later phase.
- Initial goal is local runners.

Deferred questions:

- What is the worker pool model within a server?
- Are worker pools user-owned, org-owned, global, or just named groups?
- How does a runner join/leave a worker pool?
- Does worker pool membership require approval?
- How is worker pool capacity enforced?
  - `maxConcurrentClaimsPerRunner`
  - `maxTotalClaims`

### Registration / entity information

Decision:

- Registration is just entity information: entity type metadata and stream layout.
- It is not a runner execution spec.
- Registration/entity type can provide the default dispatch policy.

Decided:

- Registration/entity info is the same as the current entity type metadata, minus webhook delivery info.
- Keep schemas, description, revision, etc.
- Webhook delivery info becomes a target inside `dispatchPolicy` / `defaultDispatchPolicy` rather than `serve_endpoint`.

Still open:

- Exact table shape / whether this is simply the existing entity type record renamed or lightly refactored.
- What is evaluated live:
  - runner disabled status,
  - authenticated user id,
  - runner `ownerUserId`,
  - dispatch target match.

### Paths and naming

Decision: paths are good.

- Durable stream paths stay clean at the root:
  - `/<stream-name>` for stream operations
  - `/{entityType}/{entityPath}/main` style entity streams, where the path is the entity identity
  - `/runners/{runnerId}/wake` for pinned runner wake streams
  - `/worker-pools/{workerPoolId}/wake` for future shared worker pool wake streams

- Technical/control routes use the reserved `_electric` prefix so they do not collide with stream names:
  - `/_electric/entities/...` for entity control operations
  - `/_electric/subscriptions/...` for webhook subscriptions
  - `/_electric/consumers/...` for consumers / mutex APIs

- Multi-tenancy:
  - OSS is a single shared scope: no tenant prefix.
  - Cloud selects the server with `?service=...`, mirroring the Electric pattern.
  - CLI/client URLs should otherwise be identical across OSS and Cloud.

### Auth and ownership

Broad auth remains out of scope for this PR and requires a separate design exercise.

This PR includes only a narrow local-runner safety gate via a host-provided `authenticateRequest` hook: runner registration binds to the authenticated user when configured; runner-target spawn/acquire require that same user to own the enabled target runner; webhook-only flows remain unauthenticated by Agents Server.

Future auth design should cover:

- generic OSS authenticated-user hook:
  - input request/session/token shape from host app,
  - return authenticated user id,
  - create or resolve the corresponding user entity/record,
  - return unauthenticated/error when no user can be established.
- Electric Cloud authenticated-user/user-provisioning flow.
- Local runner flow checks:
  1. caller is authenticated as a user,
  2. user entity/record exists,
  3. local runner is registered with `ownerUserId = user.id`,
  4. same user can spawn entities targeted at that runner,
  5. runner is enabled and matches entity dispatch target,
  6. runner capacity allows claim, if capacity exists,
  7. consumer mutex grants lease.
- auth/session shape for the desktop app.
- default fields for the built-in user entity.
- extension/profile model for host apps.

Cloud sandboxes can be handled later; built-in Horton/Worker are not special to this control plane and can ship/run under the Electron app's runner.

### Runner implementation boundaries

Decision:

- Runner app should not need more metadata than webhook runners already receive in the wake notification payload.
- Code distribution, install/build/run commands, local checkout management, hot reload, subprocess supervision, and app updates remain runner-app concerns.

### Observability / UI

Decision:

- UI work can come later as long as relevant data is captured in Postgres and synced via Electric.

Proposed table split:

- `users` — built-in but extendable user records.
- `entity_types` — current entity type metadata minus webhook delivery info, plus optional `defaultDispatchPolicy`.
- `entities` — existing entity identity/status plus immutable per-entity `dispatchPolicy`.
- `entity_dispatch_state` — one row per entity tracking pending source streams, outstanding wake, active claim materialization, and recovery/debug fields.
- `wake_notifications` — redacted Postgres materialization of `WakeNotification` delivery/claim state; raw claim/write tokens stay out of synced projections.
- `runners` — user-owned local runners, wake stream, admin status, claim-style liveness lease.
- `consumer_claims` — active/historical claim materialization written immediately by the consumer mutex path; primary key/unique identity is `(consumer_id, epoch)` or a synthetic id plus unique `(consumer_id, epoch)`.

Decision:

- Active claims should be materialized in a separate `consumer_claims` table, with current claim fields duplicated onto `entity_dispatch_state` for easy entity/runner UI queries if useful.

Still open:

- What should users see for:
  - runner offline,
  - runner disabled,
  - derived pending work / outstanding wake,
  - running claim,
  - expired claim recovery,
  - failed latest run?

## Future work / deferred topics

- Worker pools, shared worker-pool wake streams, membership, and capacity.
- Ordered fallback dispatch with timeout-based target expansion.
- Strict-priority vs expanding-eligibility fallback semantics.
- Sandbox → laptop artifact handoff.
- Shared artifact store / git worktree transfer as a runner-app/application concern.
- Stream compaction and server-visible cursor retention.
- Separate organizations / multi-tenant namespace model.
- Mobile push / WebSocket wake adapters.
- Sandboxing and delegated subprocess credentials.
