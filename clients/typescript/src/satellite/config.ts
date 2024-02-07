import { IBackOffOptions } from 'exponential-backoff'
import { QualifiedTablename } from '../util/tablename'
import { Insertable, Selectable, Updateable, Generated } from 'kysely'

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
  /** Polls the database for changes every `pollingInterval` milliseconds. */
  pollingInterval: number
  /** Throttle snapshotting to once per `minSnapshotWindow` milliseconds. */
  minSnapshotWindow: number
  /** On reconnect, clear client's state if cannot catch up with Electric buffered WAL*/
  clearOnBehindWindow: boolean
  /** Backoff options for connecting with Electric*/
  connectionBackOffOptions: ConnectionBackoffOptions
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

// Describe the schema of the database for use with Kysely
// The names of the properties in this interface
// must be kept consistent with the names of the tables

export const _electric_oplog = '_electric_oplog'
export const _electric_meta = '_electric_meta'
export const _electric_migrations = '_electric_migrations'
export const _electric_trigger_settings = '_electric_trigger_settings'
export const _electric_shadow = '_electric_shadow'

export interface ElectricSchema {
  [_electric_oplog]: OplogTable
  [_electric_meta]: MetaTable
  [_electric_migrations]: MigrationsTable
  [_electric_trigger_settings]: TriggersTable
  [_electric_shadow]: ShadowTable
}

interface OplogTable {
  rowid: number
  namespace: string
  tablename: string
  optype: string
  primaryKey: string
  newRow: string | null
  oldRow: string | null
  timestamp: string
  clearTags: string
}

export type Oplog = Selectable<OplogTable>
export type NewOplog = Insertable<OplogTable>
export type OplogUpdate = Updateable<OplogTable>

interface MetaTable {
  key: string
  value: Buffer
}

export type Meta = Selectable<MetaTable>
export type NewMeta = Insertable<MetaTable>
export type MetaUpdate = Updateable<MetaTable>

export interface MigrationsTable {
  id: Generated<number>
  version: string
  applied_at: string
}

export type Migration = Selectable<MigrationsTable>
export type NewMigration = Insertable<MigrationsTable>
export type MigrationUpdate = Updateable<MigrationsTable>

interface TriggersTable {
  tablename: string
  flag: number
}

export type Trigger = Selectable<TriggersTable>
export type NewTrigger = Insertable<TriggersTable>
export type TriggerUpdate = Updateable<TriggersTable>

interface ShadowTable {
  namespace: string
  tablename: string
  primaryKey: string
  tags: string
}

export type Shadow = Selectable<ShadowTable>
export type NewShadow = Insertable<ShadowTable>
export type ShadowUpdate = Updateable<ShadowTable>

export const satelliteDefaults: SatelliteOpts = {
  metaTable: new QualifiedTablename('main', _electric_meta),
  migrationsTable: new QualifiedTablename('main', _electric_migrations),
  oplogTable: new QualifiedTablename('main', _electric_oplog),
  triggersTable: new QualifiedTablename('main', _electric_trigger_settings),
  shadowTable: new QualifiedTablename('main', _electric_shadow),
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
  debug: false,
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
    if (port && typeof port != 'number') {
      errors.push(`Please provide correct type for config.replication.port`)
    }
  }

  return errors
}
