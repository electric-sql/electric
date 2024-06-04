import { QualifiedTablename } from '../util/tablename'
import { Row, Statement } from '../util/types'
import { parseTableNames } from '../util'

export type UncoordinatedDatabaseAdapter = Pick<
  DatabaseAdapter,
  'run' | 'query' | 'runInTransaction' | 'transaction'
>

// A `DatabaseAdapter` adapts a database client to provide the
// normalised interface defined here.
export interface DatabaseAdapter {
  readonly defaultNamespace: 'main' | 'public'

  // Runs the provided sql statement
  run(statement: Statement): Promise<RunResult>

  // Runs the provided sql as a transaction
  runInTransaction(...statements: Statement[]): Promise<RunResult>

  // Query the database.
  query(statement: Statement): Promise<Row[]>

  /**
   * Runs the provided __non-async__ function inside a transaction.
   *
   * The function may not use async/await otherwise the transaction may commit before
   * the queries are actually executed. This is a limitation of some adapters, that the
   * function passed to the transaction runs "synchronously" through callbacks without
   * releasing the event loop.
   */
  transaction<T>(
    f: (tx: Transaction, setResult: (res: T) => void) => void
  ): Promise<T>

  /**
   * This method is useful to execute several queries in isolation from any other queries/transactions executed through this adapter.
   * Useful to execute queries that cannot be executed inside a transaction (e.g. SQLite does not allow the `foreign_keys` PRAGMA to be modified in a transaction).
   * In that case we can use this `group` method:
   *  ```
   *  await adapter.group(async (adapter) => {
   *    await adapter.run({ sql: 'PRAGMA foreign_keys = OFF;' })
   *    ...
   *    await adapter.run({ sql: 'PRAGMA foreign_keys = ON;' })
   *  })
   *  ```
   * This snippet above ensures that no other query/transaction will be interleaved when the foreign keys are disabled.
   * @param f Function that is guaranteed to be executed in isolation from other queries/transactions executed by this adapter.
   */
  group<T>(
    f: (adapter: UncoordinatedDatabaseAdapter) => Promise<T> | T
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
