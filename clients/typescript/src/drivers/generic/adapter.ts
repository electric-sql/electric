import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
} from '../../electric/adapter'
import { Row, Statement } from '../../util'
import { Mutex } from 'async-mutex'

/**
 * A generic database adapter.
 * Uses a mutex to ensure that transactions are not interleaved.
 * Concrete adapters extending this class must implement the
 * `_run`, `_query`, and `runInTransaction` methods.
 */
abstract class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  protected txMutex: Mutex

  constructor() {
    super()
    this.txMutex = new Mutex()
  }

  /**
   * Runs a single SQL statement against the DB.
   * @param stmt The SQL statement to execute
   * @returns The number of rows modified by this statement.
   */
  abstract _run(stmt: Statement): Promise<RunResult>

  /**
   * Runs a single SQL query against the DB.
   * @param stmt The SQL statement to execute
   * @returns The rows read by the query.
   */
  abstract _query(stmt: Statement): Promise<Row[]>

  /**
   * @param statements A list of SQL statements to execute against the DB.
   */
  abstract runInTransaction(...statements: Statement[]): Promise<RunResult>

  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    const release = await this.txMutex.acquire()

    try {
      await this._run({ sql: 'BEGIN' })
    } catch (e) {
      release()
      throw e
    }

    return new Promise<T>((resolve, reject) => {
      const tx = new Transaction(this, reject)

      f(tx, (res) => {
        // Commit the transaction when the user sets the result.
        // This assumes that the user does not execute any more queries after setting the result.
        this._run({ sql: 'COMMIT' })
          .then(() => resolve(res))
          // Failed to commit
          .catch(reject)
      })
    })
      .catch((err) => {
        // something went wrong
        // let's roll back and rethrow
        return this._run({ sql: 'ROLLBACK' }).then(() => {
          throw err
        })
      })
      .finally(release)
  }

  run(stmt: Statement): Promise<RunResult> {
    // Also uses the mutex to avoid running this query while a transaction is executing.
    // Because that would make the query part of the transaction which was not the intention.
    return this.txMutex.runExclusive(() => {
      return this._run(stmt)
    })
  }

  query(stmt: Statement): Promise<Row[]> {
    // Also uses the mutex to avoid running this query while a transaction is executing.
    // Because that would make the query part of the transaction which was not the intention.
    return this.txMutex.runExclusive(() => {
      return this._query(stmt)
    })
  }

  get isLocked(): boolean {
    return this.txMutex.isLocked()
  }
}

/**
 * A generic database adapter that uses batch execution of SQL queries.
 * Extend this database adapter if your driver supports batch execution of SQL queries.
 */
export abstract class BatchDatabaseAdapter
  extends DatabaseAdapter
  implements DatabaseAdapterInterface
{
  /**
   * @param statements SQL statements to execute against the DB in a single batch.
   */
  abstract execBatch(statements: Statement[]): Promise<RunResult>

  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    // Uses a mutex to ensure that transactions are not interleaved.
    return this.txMutex.runExclusive(() => {
      return this.execBatch(statements)
    })
  }
}

/**
 * A generic database adapter that uses serial execution of SQL queries.
 * Extend this database adapter if your driver does not support batch execution of SQL queries.
 */
export abstract class SerialDatabaseAdapter
  extends DatabaseAdapter
  implements DatabaseAdapterInterface
{
  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    // Uses a mutex to ensure that transactions are not interleaved.
    const release = await this.txMutex.acquire()
    let transactionBegan = false
    let rowsAffected = 0
    try {
      await this._run({ sql: 'BEGIN' })
      transactionBegan = true
      for (const stmt of statements) {
        const { rowsAffected: rowsModified } = await this._run(stmt)
        rowsAffected += rowsModified
      }
      await this._run({ sql: 'COMMIT' })
      return {
        rowsAffected: rowsAffected,
      }
    } catch (error) {
      if (transactionBegan) {
        await this._run({ sql: 'ROLLBACK' })
      }
      throw error // rejects the promise with the reason for the rollback
    } finally {
      release()
    }
  }
}

class Transaction implements Tx {
  constructor(
    private adapter: DatabaseAdapter,
    private signalFailure: (reason?: any) => void
  ) {}

  private invokeCallback<T>(
    prom: Promise<T>,
    successCallback?: (tx: Transaction, result: T) => void,
    errorCallback?: (error: any) => void
  ) {
    prom
      .then((res) => {
        if (typeof successCallback !== 'undefined') successCallback(this, res)
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') errorCallback(err)
        this.signalFailure(err)
      })
  }

  run(
    statement: Statement,
    successCallback?: (tx: Transaction, result: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    // uses _run because we're in a transaction that already acquired the lock
    const prom = this.adapter._run(statement)
    this.invokeCallback(prom, successCallback, errorCallback)
  }

  query(
    statement: Statement,
    successCallback: (tx: Transaction, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    // uses _query because we're in a transaction that already acquired the lock
    const prom = this.adapter._query(statement)
    this.invokeCallback(prom, successCallback, errorCallback)
  }
}
