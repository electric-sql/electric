import { Row, Statement, ConnectivityState } from 'electric-sql/util'

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): ConnectivityState | null
  resetDB(dbName: string): Promise<void>
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
