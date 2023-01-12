import path from 'path-browserify'

import { Migration } from '../migrators/index'
import { Path } from '../util/types'

type AppName = string
type EnvName = string

const DEFAULTS: {
  domain: string
  env: EnvName
} = {
  domain: 'electric-sql.com',
  env: 'default',
}

// The mandatory data that must be included in the imported
// `electic.json` config file, if using it.
interface ElectricJson {
  app: AppName
  env: EnvName
  migrations: Path
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

type Overrides = ElectricConfig & {
  app?: AppName
}

const importJsonConfig = async (filePath: Path): Promise<ElectricJson> => {
  const mod: { default: ElectricJson } = await import(filePath)

  return mod.default
}

const importMigrations = async (
  configPath: Path,
  migrationsPath: Path
): Promise<Migration[]> => {
  const bundlePath = path.join(path.dirname(configPath), migrationsPath)
  const mod: { data: { migrations: Migration[] } } = await import(bundlePath)

  return mod.data.migrations
}

export const electricConfig = async (
  filePath: Path,
  overrides: Overrides
): Promise<ElectricConfig> => {
  const { migrations: migrationsPath, ...jsonConfig } = await importJsonConfig(
    filePath
  )
  const migrations = await importMigrations(filePath, migrationsPath)

  return {
    ...jsonConfig,
    ...overrides,
    migrations,
  }
}

export const hydrateConfig = (
  config: ElectricConfig
): Required<ElectricConfig> => {
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
