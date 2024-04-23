import { Row, Statement, ConnectivityStatus } from 'electric-sql/util'

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): ConnectivityStatus | 'Not found'
  resetDB(dbName: string): Promise<void>
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
