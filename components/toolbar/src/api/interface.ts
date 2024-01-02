import { Row, Statement, ConnectivityState } from 'electric-sql/util'

export interface Interface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): ConnectivityState | 'Not found'
  resetDB(dbName: string): Promise<void>
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
