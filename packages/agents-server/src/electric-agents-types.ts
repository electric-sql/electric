/**
 * Types for the Electric Agents entity runtime.
 */

import type { WebhookNotification } from '@electric-ax/agents-runtime'
import type { Principal } from './principal.js'

type WakeNotification = WebhookNotification

export type RequestPrincipal = Principal
export type AuthenticateRequest = (
  request: Request
) => Promise<Principal | null> | Principal | null

export type EntityStatus = `spawning` | `running` | `idle` | `stopped`

const VALID_ENTITY_STATUSES = new Set<string>([
  `spawning`,
  `running`,
  `idle`,
  `stopped`,
])

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

export interface ElectricAgentsEntity {
  url: string
  type: string
  status: EntityStatus
  streams: {
    main: string
    error: string
  }
  subscription_id: string
  dispatch_policy?: DispatchPolicy
  write_token: string
  tags: Record<string, string>
  spawn_args?: Record<string, unknown>
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
  streams: { main: string; error: string }
  dispatch_policy?: DispatchPolicy
  tags: Record<string, string>
  spawn_args?: Record<string, unknown>
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
    parent: entity.parent,
    created_by: entity.created_by,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

export interface ElectricAgentsEntityType {
  name: string
  description: string
  creation_schema?: Record<string, unknown>
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
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
  serve_endpoint?: string
  default_dispatch_policy?: DispatchPolicy
}

export interface TypedSpawnRequest {
  instance_id: string
  args?: Record<string, unknown>
  tags?: Record<string, string>
  parent?: string
  dispatch_policy?: DispatchPolicy
  initialMessage?: unknown
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
  }
}

export interface SendRequest {
  from?: string
  payload?: unknown
  key?: string
  type?: string
  mode?: `immediate` | `queued` | `paused` | `steer`
  position?: string
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
export const ErrCodeCallbackNotFound = `CALLBACK_NOT_FOUND`
