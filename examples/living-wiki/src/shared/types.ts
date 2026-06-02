export type AppEnvName = `local` | `test` | `preview` | `production` | string

export type HealthResponse = {
  ok: true
  app: `living-wiki`
  env: AppEnvName
  electricCloudConfigured: boolean
  electricAgentsSpaceId: string
  seededDemoEnabled: boolean
}

export type ErrorResponse = {
  ok: false
  error: string
}
