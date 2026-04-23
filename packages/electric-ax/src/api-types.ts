export interface ElectricAgentsEntityRow {
  url: string
  type: string
  status: string
  tags: Record<string, string>
  spawn_args?: Record<string, unknown>
  parent?: string
  created_at: number
  updated_at: number
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
