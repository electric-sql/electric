/**
 * Types for the Electric Agents entity runtime.
 */

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

export interface ElectricAgentsEntity {
  url: string
  type: string
  status: EntityStatus
  streams: {
    main: string
    error: string
  }
  subscription_id: string
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
}

export interface TypedSpawnRequest {
  instance_id: string
  args?: Record<string, unknown>
  tags?: Record<string, string>
  parent?: string
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
