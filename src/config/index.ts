import { Migration } from '../migrators/index'
import { relativePath, relativeImportPath } from '../util/path'
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
export type HydratedConfig = Required<ElectricConfig>

const importConfig = async (filePath: Path): Promise<ElectricJson> => {
  const mod: { default: ElectricJson } = await import(filePath)

  return mod.default
}

const importMigrations = async (
  configPath: Path,
  migrationsPath: Path
): Promise<Migration[]> => {
  const bundlePath = relativePath(configPath, migrationsPath)
  const {
    data: { migrations },
  } = await import(bundlePath)

  return migrations
}

export const electricConfig = async (
  configFilePath: Path,
  importMetaUrl: Path,
  overrides: Partial<ElectricConfig> = {}
): Promise<ElectricConfig> => {
  const configPath = relativeImportPath(configFilePath, importMetaUrl)

  const { migrations: migrationsPath, ...config } = await importConfig(
    configPath
  )
  const migrations = await importMigrations(configPath, migrationsPath)

  return {
    ...config,
    ...overrides,
    migrations,
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
