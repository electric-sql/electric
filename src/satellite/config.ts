import { QualifiedTablename } from '../util/tablename'
import { Migration } from '../migrators/index'

export interface SatelliteOpts {
  // The database table where Satellite keeps its processing metadata.
  metaTable: QualifiedTablename,
  // The database table where the bundle migrator keeps its metadata.
  migrationsTable: QualifiedTablename,
  // The database table where change operations are written to by the triggers
  // automatically added to all tables in the user defined DDL schema.
  oplogTable: QualifiedTablename,
  // The database table that controls active opLog triggers.
  triggersTable: QualifiedTablename,
  // Polls the database for changes every `pollingInterval` milliseconds.
  pollingInterval: number,
  // Throttle snapshotting to once per `minSnapshotWindow` milliseconds.
  minSnapshotWindow: number,
}

export interface SatelliteOverrides {
  metaTable?: QualifiedTablename,
  migrationsTable?: QualifiedTablename,
  oplogTable?: QualifiedTablename,
  pollingInterval?: number,
  minSnapshotWindow?: number,
}

export const satelliteDefaults: SatelliteOpts = {
  metaTable: new QualifiedTablename('main', '_electric_meta'),
  migrationsTable: new QualifiedTablename('main', '_electric_migrations'),
  oplogTable: new QualifiedTablename('main', '_electric_oplog'),
  triggersTable: new QualifiedTablename('main', '_electric_trigger_settings'),
  pollingInterval: 2000,
  minSnapshotWindow: 40
}

export const satelliteClientDefaults = {
  env: "default",
  timeout: 3000,
  pushPeriod: 500,
}

const baseDomain = "electric-sql.com"

export interface SatelliteClientOpts {
  app: string
  env?: string
  token: string
  host: string
  port: number
  ssl: boolean
  timeout?: number
  pushPeriod?: number
}


// Config spec
export interface ElectricConfig {
  app: string
  env?: string
  token: string
  migrations?: Migration[],
  replication?: {
    host: string
    port: number
    ssl: boolean
  }
  debug?: boolean,
}

const electricConfigDefaults: Partial<ElectricConfig> = {
  env: "default"
}

export const addDefaultsToElectricConfig = (config: ElectricConfig): ElectricConfig => {
  const newConfig = {
    ...electricConfigDefaults,
    ...config
  }

  const host = (newConfig.replication?.host) ?? `${newConfig.env}.${newConfig.app}.db.${baseDomain}`
  const port = (newConfig.replication?.port) ?? 443
  const ssl = (newConfig.replication?.ssl) ?? true

  newConfig.replication = { ...config.replication, host, port, ssl }

  return newConfig
}


export const validateConfig = (config: any) => {
  const errors = []
  if (!config) {
    errors.push(`config not defined: ${config}`)
    return errors
  }

  const { app, replication } = config

  if (!app) {
    errors.push(`please provide an app identifier: ${config}`)
    return errors
  }

  if (replication) {
    const { host, port } = replication

    if (!host) {
      errors.push(`Please provide config.replication.host`)
    }
    if (!port) {
      errors.push(`Please provide config.replication.port`)
    }
    if (port && typeof port != 'number') {
      errors.push(`Please provide correct type for config.replication.port`)
    }
  }

  return errors
};
