import { IBackOffOptions } from 'exponential-backoff'
import { QualifiedTablename } from '../util/tablename'
import { ForeignKeyChecks } from '../config'

export type ConnectionBackoffOptions = Omit<IBackOffOptions, 'retry'>
export interface SatelliteOpts {
  /** The database table where Satellite keeps its processing metadata. */
  metaTable: QualifiedTablename
  /** The database table where the bundle migrator keeps its metadata. */
  migrationsTable: QualifiedTablename
  /** The database table where change operations are written to by the triggers */
  /** automatically added to all tables in the user defined DDL schema. */
  oplogTable: QualifiedTablename
  /** The database table that controls active opLog triggers. */
  triggersTable: QualifiedTablename
  /** The database table that contains dependency tracking information */
  shadowTable: QualifiedTablename
  /** The database table that holds information about established subscriptions */
  subscriptionsTable: QualifiedTablename
  /** Polls the database for changes every `pollingInterval` milliseconds. */
  pollingInterval: number
  /** Throttle snapshotting to once per `minSnapshotWindow` milliseconds. */
  minSnapshotWindow: number
  /** On reconnect, clear client's state if cannot catch up with Electric buffered WAL */
  clearOnBehindWindow: boolean
  /** Backoff options for connecting with Electric*/
  connectionBackOffOptions: ConnectionBackoffOptions
  /**
   * Whether to enable or disable FK checks when applying incoming (i.e. remote) transactions to the local SQLite database.
   * When set to `inherit` the FK pragma is left untouched.
   * This option defaults to `disable` which disables FK checks on incoming transactions.
   * This option only affects FK checks on SQLite databases and should not be modified when using Postgres.
   */
  fkChecks: ForeignKeyChecks
  /** With debug mode enabled, Satellite can show additional logs. */
  debug: boolean
}

export interface SatelliteOverrides {
  metaTable?: QualifiedTablename
  migrationsTable?: QualifiedTablename
  oplogTable?: QualifiedTablename
  pollingInterval?: number
  minSnapshotWindow?: number
}

export const _electric_oplog = '_electric_oplog'
export const _electric_meta = '_electric_meta'
export const _electric_migrations = '_electric_migrations'
export const _electric_trigger_settings = '_electric_trigger_settings'
export const _electric_shadow = '_electric_shadow'
export const _electric_subscriptions = '_electric_subscriptions'

export const satelliteDefaults: (namespace: string) => SatelliteOpts = (
  namespace: string
) => {
  return {
    metaTable: new QualifiedTablename(namespace, _electric_meta),
    migrationsTable: new QualifiedTablename(namespace, _electric_migrations),
    oplogTable: new QualifiedTablename(namespace, _electric_oplog),
    triggersTable: new QualifiedTablename(
      namespace,
      _electric_trigger_settings
    ),
    shadowTable: new QualifiedTablename(namespace, _electric_shadow),
    subscriptionsTable: new QualifiedTablename(
      namespace,
      _electric_subscriptions
    ),
    pollingInterval: 2000,
    minSnapshotWindow: 40,
    clearOnBehindWindow: true,
    connectionBackOffOptions: {
      delayFirstAttempt: false,
      startingDelay: 1000,
      jitter: 'full',
      maxDelay: 10000,
      numOfAttempts: 50,
      timeMultiple: 2,
    },
    fkChecks: ForeignKeyChecks.disabled,
    debug: false,
  }
}

export const satelliteClientDefaults = {
  pushPeriod: 500,
}

export interface SatelliteClientOpts {
  host: string
  port: number
  ssl: boolean
  timeout: number
  pushPeriod?: number
  dialect: 'SQLite' | 'Postgres'
}

export const validateConfig = (config: any) => {
  const errors = []
  if (!config) {
    errors.push(`config not defined: ${config}`)
    return errors
  }

  const { replication } = config

  if (replication) {
    const { host, port } = replication

    if (!host) {
      errors.push(`Please provide config.replication.host`)
    }
    if (!port) {
      errors.push(`Please provide config.replication.port`)
    }
    if (port && typeof port !== 'number') {
      errors.push(`Please provide correct type for config.replication.port`)
    }
  }

  return errors
}
