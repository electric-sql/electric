import { Shape } from 'electric-sql/satellite'
import { Row, Statement, ConnectivityState } from 'electric-sql/util'
import { SqlDialect } from './statements'
import { SyncStatus } from 'electric-sql/client/model'

export type UnsubscribeFunction = () => void

export type DebugShape = { key: string; shape: Shape; status: SyncStatus }

export interface TableColumn {
  name: string
  type: string
  nullable: boolean
  defaultVal: string
}

export interface DbTableInfo {
  name: string
  sql?: string
  columns: TableColumn[]
}

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): ConnectivityState | null
  subscribeToSatelliteStatus(
    name: string,
    callback: (connectivityState: ConnectivityState) => void,
  ): UnsubscribeFunction

  toggleSatelliteStatus(name: string): Promise<void>

  getSatelliteShapeSubscriptions(name: string): DebugShape[]

  resetDb(dbName: string): Promise<void>
  queryDb(dbName: string, statement: Statement): Promise<Row[]>

  getDbDialect(name: string): Promise<SqlDialect>

  getDbTables(dbName: string): Promise<DbTableInfo[]>
  getElectricTables(dbName: string): Promise<DbTableInfo[]>

  subscribeToDbTable(
    dbName: string,
    tableName: string,
    callback: () => void,
  ): UnsubscribeFunction
}
