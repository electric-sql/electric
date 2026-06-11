/**
 * Types for the Electric Agents entity runtime.
 */

import type {
  PullWakeRunnerHealth,
  SlashCommandDefinition,
  WebhookNotification,
} from '@electric-ax/agents-runtime'
import type { Principal } from './principal.js'

type WakeNotification = WebhookNotification

export type RequestPrincipal = Principal
export type AuthenticateRequest = (
  request: Request
) => Promise<Principal | null> | Principal | null

export type EntityStatus =
  | `spawning`
  | `running`
  | `idle`
  | `paused`
  | `stopping`
  | `stopped`
  | `killed`

export const ENTITY_SIGNALS = [
  `SIGINT`,
  `SIGHUP`,
  `SIGTERM`,
  `SIGKILL`,
  `SIGSTOP`,
  `SIGCONT`,
  `SIGUSR`,
] as const

export type EntitySignal = (typeof ENTITY_SIGNALS)[number]

const VALID_ENTITY_STATUSES = new Set<string>([
  `spawning`,
  `running`,
  `idle`,
  `paused`,
  `stopping`,
  `stopped`,
  `killed`,
])

const VALID_ENTITY_SIGNALS = new Set<string>(ENTITY_SIGNALS)

export function assertEntityStatus(s: string): EntityStatus {
  if (!VALID_ENTITY_STATUSES.has(s)) {
    throw new Error(`Invalid entity status: "${s}"`)
  }
  return s as EntityStatus
}

export type DispatchTarget =
  | { type: `webhook`; url: string; subscription_id?: string }
  | { type: `runner`; runnerId: string; subscription_id?: string }

export interface DispatchPolicy {
  readonly targets: readonly [DispatchTarget, ...ReadonlyArray<DispatchTarget>]
}

export type RunnerKind = `local` | `cloud-worker` | `sandbox` | `ci` | `server`
export type RunnerAdminStatus = `enabled` | `disabled`
export type RunnerLiveness = `online` | `offline`

export type PermissionSubjectKind = `principal` | `principal_kind`
export type PermissionSubject = {
  subject_kind: PermissionSubjectKind
  subject_value: string
}
export type EntityPermission =
  | `read`
  | `write`
  | `delete`
  | `signal`
  | `fork`
  | `schedule`
  | `spawn`
  | `manage`
export type EntityTypePermission = `spawn` | `manage`
export type EntityPermissionPropagation = `self` | `descendants`

export interface EntityPermissionGrant extends PermissionSubject {
  id: number
  entity_url: string
  permission: EntityPermission
  propagation: EntityPermissionPropagation
  copy_to_children: boolean
  created_by?: string
  expires_at?: string
  created_at: string
  updated_at: string
}

export interface EntityTypePermissionGrant extends PermissionSubject {
  id: number
  entity_type: string
  permission: EntityTypePermission
  created_by?: string
  expires_at?: string
  created_at: string
  updated_at: string
}

export interface EntityTypePermissionGrantInput extends PermissionSubject {
  permission: EntityTypePermission
  expires_at?: string
}

export type AuthorizationResource =
  | { kind: `entity`; entity: ElectricAgentsEntity }
  | { kind: `entity_type`; entityType: ElectricAgentsEntityType }
  | { kind: `entity_type_registration`; entityTypeName: string }
  | {
      kind: `shared_state`
      sharedStateId: string
      linkedEntityUrls: Array<string>
    }

export type AuthorizationDecision = {
  decision: `allow` | `deny`
  expires_at?: string
}

export type AuthorizeRequest = (input: {
  tenant: string
  principal: Principal
  verb: EntityPermission | EntityTypePermission
  resource: AuthorizationResource
  request?: {
    method: string
    url: string
    headers: Record<string, string>
  }
  builtInAllowed: boolean
}) => Promise<AuthorizationDecision> | AuthorizationDecision

const VALID_RUNNER_KINDS = new Set<string>([
  `local`,
  `cloud-worker`,
  `sandbox`,
  `ci`,
  `server`,
])
const VALID_RUNNER_ADMIN_STATUSES = new Set<string>([`enabled`, `disabled`])

export function assertRunnerKind(s: string): RunnerKind {
  if (!VALID_RUNNER_KINDS.has(s)) {
    throw new Error(`Invalid runner kind: "${s}"`)
  }
  return s as RunnerKind
}

export function assertRunnerAdminStatus(s: string): RunnerAdminStatus {
  if (!VALID_RUNNER_ADMIN_STATUSES.has(s)) {
    throw new Error(`Invalid runner admin status: "${s}"`)
  }
  return s as RunnerAdminStatus
}

export type WakeDeliveryStatus =
  | `queued`
  | `delivered`
  | `failed`
  | `superseded`
export type WakeClaimStatus = `unclaimed` | `claimed` | `completed` | `expired`
export type ConsumerClaimStatus = `active` | `released` | `expired` | `failed`

export interface SourceStreamOffset {
  path: string
  offset: string
}

export type PublicWakeNotification = Omit<
  WakeNotification,
  `callback` | `claimToken` | `entity`
> & {
  entity?: NonNullable<WakeNotification[`entity`]>
}

export interface ElectricAgentsUser {
  id: string
  display_name?: string
  email?: string
  avatar_url?: string
  auth_provider?: string
  auth_subject?: string
  profile: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RunnerActiveClaim {
  entityPath: string
  consumerId: string
  claimedAt: string
  leaseExpiresAt?: string
}

export interface SandboxProfileAdvertisement {
  name: string
  label: string
  description?: string
  /**
   * True for off-host (remote-provider) profiles, reachable from any runner.
   * Absent/false means the sandbox is host-local, so a shared sandbox on this
   * profile requires its collaborators to be pinned to a single runner. Set
   * by the runtime per profile (see SandboxProfile.remote).
   */
  remote?: boolean
}

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
  sandbox_profiles: Array<SandboxProfileAdvertisement>
  created_at: string
  updated_at: string
}

export interface RegisterRunnerRequest {
  id: string
  owner_principal: string
  label: string
  kind?: RunnerKind
  admin_status?: RunnerAdminStatus
  wake_stream?: string
}

export interface RunnerHeartbeatRequest {
  lease_ms?: number
  wake_stream_offset?: string
  wakeStreamOffset?: string
  liveness_lease_expires_at?: string
  diagnostics?: Record<string, unknown>
}

export type RunnerHealthStatus = `healthy` | `degraded` | `unhealthy`
export type RunnerClientDiagnostics = Partial<
  Omit<PullWakeRunnerHealth, `running` | `offset`>
>

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
  client: RunnerClientDiagnostics | null
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

export interface EntityDispatchState {
  entity_url: string
  pending_source_streams: Array<SourceStreamOffset>
  pending_reason?: string
  pending_since?: string
  outstanding_wake_id?: string
  outstanding_wake_target?: DispatchTarget
  outstanding_wake_created_at?: string
  active_consumer_id?: string
  active_runner_id?: string
  active_epoch?: number
  active_claimed_at?: string
  active_lease_expires_at?: string
  last_wake_id?: string
  last_claimed_at?: string
  last_released_at?: string
  last_completed_at?: string
  last_error?: string
  updated_at: string
}

export interface WakeNotificationRow {
  wake_id: string
  entity_url: string
  target_type: DispatchTarget[`type`]
  target_runner_id?: string
  target_webhook_url?: string
  target_worker_pool_id?: string
  runner_wake_stream?: string
  runner_wake_stream_offset?: string
  notification_public: PublicWakeNotification
  delivery_status: WakeDeliveryStatus
  claim_status: WakeClaimStatus
  created_at: string
  delivered_at?: string
  claimed_at?: string
  resolved_at?: string
}

export interface ConsumerClaim {
  consumer_id: string
  epoch: number
  wake_id?: string
  entity_url: string
  stream_path: string
  runner_id?: string
  status: ConsumerClaimStatus
  claimed_at: string
  last_heartbeat_at?: string
  lease_expires_at?: string
  released_at?: string
  acked_streams?: Array<SourceStreamOffset>
  updated_at: string
}

export function assertEntitySignal(s: string): EntitySignal {
  if (!VALID_ENTITY_SIGNALS.has(s)) {
    throw new Error(`Invalid entity signal: "${s}"`)
  }
  return s as EntitySignal
}

export function isTerminalEntityStatus(status: EntityStatus): boolean {
  return status === `stopped` || status === `killed`
}

export function rejectsNormalWrites(status: EntityStatus): boolean {
  return status === `stopping` || isTerminalEntityStatus(status)
}

export function expectedSignalStatus(
  status: EntityStatus,
  signal: EntitySignal
): EntityStatus {
  switch (signal) {
    case `SIGKILL`:
      return `killed`
    case `SIGTERM`:
      return status === `idle` ? `stopped` : `stopping`
    case `SIGSTOP`:
      return status === `idle` ? `paused` : status
    case `SIGCONT`:
      return status === `paused` ? `idle` : status
    case `SIGINT`:
    case `SIGHUP`:
    case `SIGUSR`:
      return status
  }
}

/**
 * Resolved sandbox selection stored on an entity and replayed to the runtime at
 * wake. Only an explicit / inherited cross-entity `key` is persisted here;
 * `scope`-derived keys are computed at wake time (and so left unstored, keeping
 * the co-location guard keyed on genuine cross-entity sharing). `persistent`
 * defaults by scope at wake time when unset.
 */
export interface EntitySandboxSelection {
  profile: string
  key?: string
  scope?: `entity` | `wake`
  persistent?: boolean
  /**
   * Whether the entity owns the sandbox (create + govern teardown) or only
   * attaches to an owner's. Stored as `false` for an attacher (e.g. an
   * `inherit` spawn); omitted ⇒ owner (the default).
   */
  owner?: boolean
}

/**
 * Spawn-time sandbox CHOICE — the request input, before resolution. Resolved
 * into an {@link EntitySandboxSelection} by the spawn path. The wire schema for
 * this shape lives in `sandbox-choice-schema.ts` (mirrors how `DispatchPolicy`
 * pairs with `dispatch-policy-schema.ts`).
 */
export interface SandboxChoice {
  /** Profile name advertised by the target runner. */
  profile?: string
  /** Explicit cross-entity key to join (or start) a shared sandbox. */
  key?: string
  /** Identity scope when no explicit `key`: per-entity (default) or per-wake. */
  scope?: `entity` | `wake`
  /** Idle-teardown durability; defaults by scope when unset. */
  persistent?: boolean
  /** Whether this entity owns the sandbox (default) or only attaches to one. */
  owner?: boolean
  /** Reuse the parent entity's resolved sandbox (attach-only). */
  inherit?: boolean
}

export interface ElectricAgentsEntity {
  url: string
  type: string
  status: EntityStatus
  streams: {
    main: string
  }
  subscription_id: string
  dispatch_policy?: DispatchPolicy
  write_token: string
  tags: Record<string, string>
  spawn_args?: Record<string, unknown>
  /**
   * Resolved sandbox selection. An explicit `key` lets entities collaborate on
   * one workspace and is the only key form persisted (it's cross-entity, so the
   * co-location guard applies); a `scope` ('entity' default / 'wake') instead
   * derives the key at wake time, so it's left unstored. `persistent` chooses
   * idle durability.
   */
  sandbox?: EntitySandboxSelection
  parent?: string
  type_revision?: number
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
  created_by?: string
  created_at: number
  updated_at: number
}

/** Public-facing entity — internal fields stripped. Standalone type so new internal fields don't silently leak. */
export interface PublicElectricAgentsEntity {
  url: string
  type: string
  status: EntityStatus
  streams: { main: string }
  dispatch_policy?: DispatchPolicy
  tags: Record<string, string>
  spawn_args?: Record<string, unknown>
  sandbox?: EntitySandboxSelection
  parent?: string
  created_by?: string
  created_at: number
  updated_at: number
}

/** Entity row as stored in Postgres / returned by Electric shapes (no derived `streams` field). */
export type ElectricAgentsEntityRow = Omit<
  PublicElectricAgentsEntity,
  `streams`
>

/** Strip internal fields (write_token, subscription_id) from an entity. */
export function toPublicEntity(
  entity: ElectricAgentsEntity
): PublicElectricAgentsEntity {
  return {
    url: entity.url,
    type: entity.type,
    status: entity.status,
    streams: entity.streams,
    dispatch_policy: entity.dispatch_policy,
    tags: entity.tags,
    spawn_args: entity.spawn_args,
    sandbox: entity.sandbox,
    parent: entity.parent,
    created_by: entity.created_by,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

/** Per-collection config making an entity-state collection externally writable via the router. */
export interface ExternallyWritableCollectionConfig {
  /** Durable-stream event type for this collection, e.g. `state:comments`. */
  type: string
}

export interface ElectricAgentsEntityType {
  name: string
  description: string
  creation_schema?: Record<string, unknown>
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
  externally_writable_collections?: Record<
    string,
    ExternallyWritableCollectionConfig
  >
  slash_commands?: Array<SlashCommandDefinition>
  serve_endpoint?: string
  default_dispatch_policy?: DispatchPolicy
  revision: number
  created_at: string
  updated_at: string
}

export interface RegisterEntityTypeRequest {
  name: string
  description: string
  creation_schema?: Record<string, unknown>
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
  externally_writable_collections?: Record<
    string,
    ExternallyWritableCollectionConfig
  >
  slash_commands?: Array<SlashCommandDefinition>
  serve_endpoint?: string
  default_dispatch_policy?: DispatchPolicy
  permission_grants?: Array<EntityTypePermissionGrantInput>
}

export interface TypedSpawnRequest {
  instance_id: string
  args?: Record<string, unknown>
  tags?: Record<string, string>
  parent?: string
  dispatch_policy?: DispatchPolicy
  /**
   * Sandbox selection: `profile` for a sandbox (optionally with `scope` /
   * `persistent`), `key` to join (or start) an explicit shared one, or
   * `inherit: true` to reuse the parent's resolved sandbox.
   */
  sandbox?: SandboxChoice
  initialMessage?: unknown
  initialMessageType?: string
  created_by?: string
  wake?: {
    subscriberUrl: string
    condition:
      | `runFinished`
      | {
          on: `change`
          collections?: Array<string>
          ops?: Array<`insert` | `update` | `delete`>
        }
    debounceMs?: number
    timeoutMs?: number
    includeResponse?: boolean
    manifestKey?: string
  }
}

export interface SendRequest {
  from?: string
  from_principal?: string
  from_agent?: string
  payload?: unknown
  key?: string
  type?: string
  mode?: `immediate` | `queued` | `paused` | `steer`
  position?: string
}

export interface SignalRequest {
  signal: EntitySignal
  reason?: string
  payload?: unknown
}

export interface SignalResponse {
  url: string
  signal: EntitySignal
  previous_state: EntityStatus
  new_state: EntityStatus
  created_at: number
  txid: number
}

export interface SetTagRequest {
  value: string
}

export interface EntityListFilter {
  type?: string
  status?: EntityStatus
  created_by?: string
}

export const ErrCodeDuplicateURL = `DUPLICATE_URL`
export const ErrCodeUnauthorized = `UNAUTHORIZED`
export const ErrCodeNoSubscription = `NO_SUBSCRIPTION`
export const ErrCodeNotFound = `NOT_FOUND`
export const ErrCodeNotRunning = `NOT_RUNNING`
export const ErrCodeInvalidRequest = `INVALID_REQUEST`
export const ErrCodeInvalidSignal = `INVALID_SIGNAL`
export const ErrCodeUnknownEntityType = `UNKNOWN_ENTITY_TYPE`
export const ErrCodeSchemaValidationFailed = `SCHEMA_VALIDATION_FAILED`
export const ErrCodeUnknownMessageType = `UNKNOWN_MESSAGE_TYPE`
export const ErrCodeUnknownEventType = `UNKNOWN_EVENT_TYPE`
export const ErrCodeSchemaKeyExists = `SCHEMA_KEY_EXISTS`
export const ErrCodeServeEndpointUnreachable = `SERVE_ENDPOINT_UNREACHABLE`
export const ErrCodeServeEndpointNameMismatch = `SERVE_ENDPOINT_NAME_MISMATCH`
export const ErrCodeForkInProgress = `FORK_IN_PROGRESS`
export const ErrCodeForkWaitTimeout = `FORK_WAIT_TIMEOUT`
export const ErrCodeEntityPersistFailed = `ENTITY_PERSIST_FAILED`
export const ErrCodeAgentUiNotFound = `AGENT_UI_NOT_FOUND`
export const ErrCodeSubscriptionNotFound = `SUBSCRIPTION_NOT_FOUND`
export const ErrCodeWakeCallbackNotFound = `WAKE_CALLBACK_NOT_FOUND`
