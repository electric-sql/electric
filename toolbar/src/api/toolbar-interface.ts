import { Row, Statement } from './types'

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): string
  resetDB(dbName: string): void
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
