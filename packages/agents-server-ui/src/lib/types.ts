export interface ServerConfig {
  id: string
  name: string
  url: string
  source?: `manual` | `local-discovery` | `electric-cloud`
  desiredState?: `connected` | `disconnected`
  localRuntimeEnabled?: boolean
  headers?: Record<string, string>
  /** Legacy field from older UI builds. Kept so persisted configs still parse. */
  auth?: string
  /**
   * For `source: 'electric-cloud'` only — the `stream_services.id`
   * the cloud-agents-server uses to identify this tenant. Persisted
   * with the rest of the server config so the desktop's main
   * process can inject `Authorization: Bearer <agents token>` on
   * every outgoing request to this tenant-scoped base URL. The
   * matching agents token lives in the encrypted `SecretStore` keyed
   * by `tenantId`, never in `settings.json`.
   */
  tenantId?: string
}

export type PublicEntityStatus =
  | `spawning`
  | `running`
  | `idle`
  | `paused`
  | `stopping`
  | `stopped`
  | `killed`

export interface PublicEntity {
  url: string
  type: string
  status: PublicEntityStatus
  streams: { main: string }
  tags: Record<string, string>
  spawn_args: Record<string, unknown>
  parent: string | null
  created_at: number
  updated_at: number
}

export function getEntityInstanceName(entityUrl: string): string {
  return decodeURIComponent(entityUrl.split(`/`).pop() ?? entityUrl)
}

export interface EntityType {
  name: string
  description: string
  creation_schema?: unknown
  inbox_schemas?: Record<string, unknown>
  state_schemas?: Record<string, unknown>
  serve_endpoint?: string
  created_at: string
  updated_at: string
}
