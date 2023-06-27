import { Migration } from '../migrators/index'

export interface ElectricConfig {
  migrations: Migration[]
  replication?: {
    host: string
    port: number
    ssl: boolean
  }
  debug?: boolean
}
export type HydratedConfig = Required<ElectricConfig>

export const hydrateConfig = (config: ElectricConfig): HydratedConfig => {
  const host = config.replication?.host ?? '127.0.0.1'
  const port = config.replication?.port ?? 5133
  const ssl = config.replication?.ssl ?? false
  const replication = { ...config.replication, host, port, ssl }

  return {
    migrations: config.migrations ?? [],
    replication: config.replication ?? replication,
    debug: config.debug ?? false,
  }
}
