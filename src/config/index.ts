import { Migration } from '../migrators/index'

type AppName = string
type EnvName = string

const DEFAULTS = {
  domain: 'electric-sql.com',
  env: 'default',
}

// The mandatory data that must be included in the imported
// `electic.json` config file, if using it.
interface ElectricJson {
  app: AppName
  env: EnvName
}

interface MigrationsBundle {
  migrations: Migration[]
}

export interface ElectricConfig {
  app: AppName
  env?: EnvName
  migrations?: Migration[]
  replication?: {
    host: string
    port: number
    ssl: boolean
  }
  console?: {
    host: string
  }
  debug?: boolean
}
export type HydratedConfig = Required<ElectricConfig>

export const configure = (
  config: ElectricJson,
  bundle: MigrationsBundle,
  overrides: Partial<ElectricConfig> = {}
): ElectricConfig => {
  return {
    ...config,
    ...overrides,
    migrations: bundle.migrations,
  }
}

export const hydrateConfig = (config: ElectricConfig): HydratedConfig => {
  const domain = DEFAULTS.domain
  const env = config.env ?? DEFAULTS.env

  const host = config.replication?.host ?? `${env}.${config.app}.db.${domain}`
  const port = config.replication?.port ?? 443
  const ssl = config.replication?.ssl ?? true
  const replication = { ...config.replication, host, port, ssl }

  const consoleHost = config.console?.host ?? `console.${domain}`
  const consoleClient = { ...config.console, host: consoleHost }

  return {
    app: config.app,
    env: env,
    migrations: config.migrations ?? [],
    replication: config.replication ?? replication,
    console: config.console ?? consoleClient,
    debug: config.debug ?? false,
  }
}
