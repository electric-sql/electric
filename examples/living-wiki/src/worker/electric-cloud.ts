import type { WorkerEnv } from './env'

export type ElectricCloudConfig = {
  apiUrl: string
  hasToken: boolean
  agentsSpaceId: string
}

export function getElectricCloudConfig(env: WorkerEnv): ElectricCloudConfig {
  return {
    apiUrl: env.ELECTRIC_CLOUD_API_URL,
    hasToken: Boolean(env.ELECTRIC_CLOUD_API_TOKEN),
    agentsSpaceId: env.ELECTRIC_AGENTS_SPACE_ID,
  }
}
