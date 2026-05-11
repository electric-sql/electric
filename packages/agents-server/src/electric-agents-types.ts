/**
 * Types for the Electric Agents entity runtime.
 */

import type { IncomingMessage } from 'node:http'
import type { WakeNotification } from '@electric-ax/agents-runtime'

export interface AuthenticatedRequestUser {
  userId: string
  email?: string
  name?: string
}

export type AuthenticateRequest = (
  req: IncomingMessage
) => Promise<AuthenticatedRequestUser | null> | AuthenticatedRequestUser | null

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
  | { type: `webhook`; url: string }
  | { type: `runner`; runnerId: string }

export interface DispatchPolicy {
  // v1 uses exactly one target; the tuple shape leaves room for ordered targets later.
  readonly targets: readonly [DispatchTarget, ...ReadonlyArray<DispatchTarget>]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

export function assertDispatchPolicy(
  value: unknown,
  label = `dispatch_policy`
): DispatchPolicy {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  const targets = value.targets
  if (!Array.isArray(targets)) {
    throw new Error(`${label}.targets must be an array`)
  }
  if (targets.length !== 1) {
    throw new Error(
      `${label}.targets must contain exactly one target for dispatch policy v1`
    )
  }

  const target = targets[0]
  if (!isRecord(target)) {
    throw new Error(`${label}.targets[0] must be an object`)
  }

  const type = target.type
  if (type === `webhook`) {
    if (typeof target.url !== `string`) {
      throw new Error(
        `${label}.targets[0].url must be a string for webhook targets`
      )
    }
    return value as unknown as DispatchPolicy
  }

  if (type === `runner`) {
    if (typeof target.runnerId !== `string`) {
      throw new Error(
        `${label}.targets[0].runnerId must be a string for runner targets`
      )
    }
    return value as unknown as DispatchPolicy
  }

  throw new Error(
    `${label}.targets[0].type must be "webhook" or "runner" for dispatch policy v1`
  )
}

export type RunnerKind = `local` | `cloud-worker` | `sandbox` | `ci` | `server`
export type RunnerAdminStatus = `enabled` | `disabled`
export type RunnerLiveness = `online` | `offline`

const VALID_RUNNER_KIND_VALUES = {
  local: true,
  'cloud-worker': true,
  sandbox: true,
  ci: true,
  server: true,
} satisfies Record<RunnerKind, true>
const VALID_RUNNER_KINDS = new Set<string>(
  Object.keys(VALID_RUNNER_KIND_VALUES)
)

const VALID_RUNNER_ADMIN_STATUS_VALUES = {
  enabled: true,
  disabled: true,
} satisfies Record<RunnerAdminStatus, true>
const VALID_RUNNER_ADMIN_STATUSES = new Set<string>(
  Object.keys(VALID_RUNNER_ADMIN_STATUS_VALUES)
)

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

export interface WakeEvent {
  source: string
  type: string
  fromOffset: number
  toOffset: number
  eventCount: number
  payload?: unknown
  summary?: string
  fullRef?: string
}

export type { WakeNotification } from '@electric-ax/agents-runtime'

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
  owner_user_id: string
  label: string
  kind: RunnerKind
  admin_status: RunnerAdminStatus
  liveness?: RunnerLiveness
  last_seen_at?: string
  liveness_lease_expires_at?: string
  active_claims?: Array<RunnerActiveClaim>
  wake_stream: string
  created_at: string
  updated_at: string
}

export interface RegisterRunnerRequest {
  id: string
  owner_user_id: string
  label: string
  kind?: RunnerKind
  admin_status?: RunnerAdminStatus
  wake_stream?: string
}

export interface RunnerHeartbeatRequest {
  lease_ms?: number
  liveness_lease_expires_at?: string
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
}

export interface SetTagRequest {
  value: string
}

export interface EntityListFilter {
  type?: string
  status?: EntityStatus
}

export const ErrCodeDuplicateURL = `DUPLICATE_URL`
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
