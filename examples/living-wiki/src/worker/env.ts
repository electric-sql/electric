export type WorkerEnv = {
  ASSETS?: Fetcher
  APP_ENV: string
  ELECTRIC_CLOUD_API_URL: string
  ELECTRIC_CLOUD_API_TOKEN?: string
  ELECTRIC_AGENTS_SPACE_ID: string
  ENABLE_SEEDED_DEMO?: string
}

export function isSeededDemoEnabled(env: WorkerEnv): boolean {
  return env.ENABLE_SEEDED_DEMO === `true`
}
