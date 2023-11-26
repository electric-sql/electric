import { AnyDatabase } from '../drivers/index'
import { QualifiedTablename } from '../util/tablename'
import { Row, Statement } from '../util/types'
import { Mutex, parseTableNames } from '../util'

export const priorities = {
  default: 'DEFAULT',
  high: 'HIGH',
} as const
export type Priority = (typeof priorities)[keyof typeof priorities]
export type PriorityMutex = Mutex<Priority>
export const priorityMutex = () =>
  new Mutex<Priority>([priorities.high, priorities.default])

/**
 * A `DatabaseAdapter` adapts a database client to provide the
 * normalised interface defined here.
 */
export interface DatabaseAdapter {
  readonly db: AnyDatabase

  // Runs the provided sql statement
  run(statement: Statement, priority?: Priority): Promise<RunResult>

  // Runs the provided sql as a transaction
  runInTransaction(...statements: Statement[]): Promise<RunResult>

  // Query the database.
  query(statement: Statement, priority?: Priority): Promise<Row[]>

  /**
   * Runs the provided __non-async__ function inside a transaction.
   *
   * The function may not use async/await otherwise the transaction may commit before
   * the queries are actually executed. This is a limitation of some adapters, that the
   * function passed to the transaction runs "synchronously" through callbacks without
   * releasing the event loop.
   */
  transaction<T>(
    f: (tx: Transaction, setResult: (res: T) => void) => void,
    priority?: Priority
  ): Promise<T>

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
