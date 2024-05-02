import { Shape } from 'electric-sql/satellite'
import { Row, Statement, ConnectivityState } from 'electric-sql/util'

export type UnsubscribeFunction = () => void

export type DebugShape = Shape & { id: string }

export interface TableColumn {
  name: string
  type: 'NULL' | 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB'
}

export interface DbTableInfo {
  name: string
  sql: string
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

  getDbTables(dbName: string): Promise<DbTableInfo[]>
  getElectricTables(dbName: string): Promise<DbTableInfo[]>
}
