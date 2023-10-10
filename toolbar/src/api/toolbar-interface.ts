import { Row as RowLocal, Statement as StatementLocal} from "electric-sql/dist/util"
export type Row = RowLocal
export type Statement = StatementLocal

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): string
  resetDB(dbName: string): void
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
