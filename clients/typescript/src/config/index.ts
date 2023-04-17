import { Migration } from '../migrators/index'

type AppName = string
type EnvName = string

const DEFAULTS = {
  domain: 'electric-sql.com',
  env: 'default',
}

export interface ElectricConfig {
  app: AppName
  env: EnvName
  migrations: Migration[]
  replication?: {
    host: string
    port: number
    ssl: boolean
  }
  console?: {
    host: string
    port: number
    ssl: boolean
  }
  debug?: boolean
}
export type HydratedConfig = Required<ElectricConfig>

export const hydrateConfig = (config: ElectricConfig): HydratedConfig => {
  const domain = DEFAULTS.domain
  const env = config.env ?? DEFAULTS.env

  const host = config.replication?.host ?? `${env}.${config.app}.db.${domain}`
  const port = config.replication?.port ?? 443
  const ssl = config.replication?.ssl ?? true
  const replication = { ...config.replication, host, port, ssl }

  const consoleHost = config.console?.host ?? `console.${domain}`
  const consoleSsl = config.console?.ssl ?? true
  const consoleClient = {
    host: consoleHost,
    ssl: consoleSsl,
    port: config.console?.port ?? (consoleSsl ? 443 : 80),
  }

  return {
    app: config.app,
    env: env,
    migrations: config.migrations ?? [],
    replication: config.replication ?? replication,
    console: config.console ?? consoleClient,
    debug: config.debug ?? false,
  }
}
