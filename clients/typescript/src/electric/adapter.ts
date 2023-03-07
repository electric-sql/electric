import { AnyDatabase } from '../drivers/index'
import { QualifiedTablename } from '../util/tablename'
import { Row, Statement } from '../util/types'
import { parseTableNames } from '../util'

// A `DatabaseAdapter` adapts a database client to provide the
// normalised interface defined here.
export interface DatabaseAdapter {
  db: AnyDatabase

  // Runs the provided sql statement
  run(statement: Statement): Promise<RunResult>

  // Runs the provided sql as a transaction
  runInTransaction(...statements: Statement[]): Promise<RunResult>

  // Query the database.
  query(statement: Statement): Promise<Row[]>

  // Runs the provided function inside a transaction
  // The function may not use async/await otherwise the transaction may commit before the queries are actually executed
  transaction<T>(
    f: (tx: Transaction, setResult: (res: T) => void) => void
  ): Promise<T | void>

  // Get the tables potentially used by the query (so that we
  // can re-query if the data in them changes).
  tableNames(statement: Statement): QualifiedTablename[]
}

export class TableNameImpl {
  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}

export interface Transaction {
  run(
    statement: Statement,
    successCallback?: (tx: Transaction, result: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void

  query(
    statement: Statement,
    successCallback: (tx: Transaction, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void
}

export interface RunResult {
  rowsAffected: number
}
