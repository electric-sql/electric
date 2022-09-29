import { QualifiedTablename } from '../util/tablename'

export interface SatelliteOpts {
  // The database table where Satellite keeps its processing metadata.
  metaTable: QualifiedTablename,
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

// As above but optional.
export interface SatelliteOverrides {
  metaTable?: QualifiedTablename,
  oplogTable?: QualifiedTablename,
  pollingInterval?: number,
  minSnapshotWindow?: number,
}

export const satelliteDefaults: SatelliteOpts = {
  metaTable: new QualifiedTablename('main', '_electric_meta'),
  oplogTable: new QualifiedTablename('main', '_electric_oplog'),
  triggersTable: new QualifiedTablename('main', '_trigger_settings'),
  pollingInterval: 2000,
  minSnapshotWindow: 40
}

export interface SatelliteClientOpts {
  appId: string
  token: string
  port: number
  address: string
  timeout?: number
  pushPeriod?: number
}

export interface SatelliteClientOverrides {
  appId?: string
  token?: string
  port?: number
  address?: string
  timeout?: number
}

export const satelliteClientDefaults = {
  appId: "",
  token: "",
  address: "127.0.0.1",
  port: 30002,
  timeout: 100000,
  pushPeriod: 500
}
