export interface ServerConfig {
  name: string
  url: string
  auth?: string
}

export type PublicEntityStatus = `spawning` | `running` | `idle` | `stopped`

export interface PublicEntity {
  url: string
  type: string
  status: PublicEntityStatus
  streams: { main: string; error: string }
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
