import { Row, Statement, ConnectivityState } from 'electric-sql/util'

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): ConnectivityState | 'Not found'
  resetDB(dbName: string): void
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
