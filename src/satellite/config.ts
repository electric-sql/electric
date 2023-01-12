import { QualifiedTablename } from '../util/tablename'

export interface SatelliteConfig {
  app: string
  env: string
}

export interface SatelliteOpts {
  // The database table where Satellite keeps its processing metadata.
  metaTable: QualifiedTablename
  // The database table where the bundle migrator keeps its metadata.
  migrationsTable: QualifiedTablename
  // The database table where change operations are written to by the triggers
  // automatically added to all tables in the user defined DDL schema.
  oplogTable: QualifiedTablename
  // The database table that controls active opLog triggers.
  triggersTable: QualifiedTablename
  // Polls the database for changes every `pollingInterval` milliseconds.
  pollingInterval: number
  // Throttle snapshotting to once per `minSnapshotWindow` milliseconds.
  minSnapshotWindow: number
}

export interface SatelliteOverrides {
  metaTable?: QualifiedTablename
  migrationsTable?: QualifiedTablename
  oplogTable?: QualifiedTablename
  pollingInterval?: number
  minSnapshotWindow?: number
}

export const satelliteDefaults: SatelliteOpts = {
  metaTable: new QualifiedTablename('main', '_electric_meta'),
  migrationsTable: new QualifiedTablename('main', '_electric_migrations'),
  oplogTable: new QualifiedTablename('main', '_electric_oplog'),
  triggersTable: new QualifiedTablename('main', '_electric_trigger_settings'),
  pollingInterval: 2000,
  minSnapshotWindow: 40,
}

export const satelliteClientDefaults = {
  timeout: 3000,
  pushPeriod: 500,
}

export interface SatelliteClientOpts {
  host: string
  port: number
  ssl: boolean
  timeout?: number
  pushPeriod?: number
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
}
