import { Row, Statement } from 'electric-sql/dist/util'

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): string
  resetDB(dbName: string): void
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
