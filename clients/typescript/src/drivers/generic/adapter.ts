import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
} from '../../electric/adapter'
import { Row, Statement } from '../../util'
import { isInsertUpdateOrDeleteStatement } from '../../util/statements'
import { Mutex } from 'async-mutex'
import { AnyDatabase } from '..'

/**
 * A generic adapter that manages transactions manually by executing `BEGIN` and `COMMIT`/`ROLLBACK` commands.
 * Uses a mutex to ensure that transactions are not interleaved.
 * Concrete adapters extending this class must implement the `exec` and `getRowsModified` methods.
 */
export abstract class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  abstract readonly db: AnyDatabase
  #txMutex: Mutex

  constructor() {
    super()
    this.#txMutex = new Mutex()
  }

  abstract exec(statement: Statement): Promise<Row[]>
  abstract getRowsModified(): number

  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    // Uses a mutex to ensure that transactions are not interleaved.
    // This is needed because transactions are executed manually using `BEGIN` and `COMMIT` commands.
    const release = await this.#txMutex.acquire()
    let open = false
    let rowsAffected = 0
    try {
      await this.exec({ sql: 'BEGIN' })
      open = true
      for (const stmt of statements) {
        await this.exec(stmt)
        if (isInsertUpdateOrDeleteStatement(stmt.sql)) {
          // Fetch the number of rows affected by the last insert, update, or delete
          rowsAffected += this.getRowsModified()
        }
      }
      return {
        rowsAffected: rowsAffected,
      }
    } catch (error) {
      await this.exec({ sql: 'ROLLBACK' })
      open = false
      throw error // rejects the promise with the reason for the rollback
    } finally {
      if (open) {
        await this.exec({ sql: 'COMMIT' })
      }
      release()
    }
  }

  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    const release = await this.#txMutex.acquire()

    try {
      await this.exec({ sql: 'BEGIN' })
    } catch (e) {
      release()
      throw e
    }

    return new Promise((resolve, reject) => {
      const releaseAndReject = (err?: any) => {
        // if the tx is rolled back, release the lock and reject the promise
        release()
        reject(err)
      }

      const tx = new Transaction(this, releaseAndReject)

      f(tx, (res) => {
        // Commit the transaction when the user sets the result.
        // This assumes that the user does not execute any more queries after setting the result.
        this.exec({ sql: 'COMMIT' })
          .then(() => {
            release()
            resolve(res)
          })
          .catch((err) => {
            release()
            reject(err)
          })
      })
    })
  }

  run(stmt: Statement): Promise<RunResult> {
    // Also uses the mutex to avoid running this query while a transaction is executing.
    // Because that would make the query part of the transaction which was not the intention.
    return this.#txMutex.runExclusive(() => {
      return this._runUncoordinated(stmt)
    })
  }

  // Do not use this uncoordinated version directly!
  // It is only meant to be used within transactions.
  async _runUncoordinated(stmt: Statement): Promise<RunResult> {
    await this.exec(stmt)
    return {
      rowsAffected: this.getRowsModified(),
    }
  }

  // This `query` function does not enforce that the query is read-only
  query(stmt: Statement): Promise<Row[]> {
    // Also uses the mutex to avoid running this query while a transaction is executing.
    // Because that would make the query part of the transaction which was not the intention.
    return this.#txMutex.runExclusive(() => {
      return this._queryUncoordinated(stmt)
    })
  }

  // Do not use this uncoordinated version directly!
  // It is only meant to be used within transactions.
  async _queryUncoordinated(stmt: Statement): Promise<Row[]> {
    return await this.exec(stmt)
  }
}

class Transaction implements Tx {
  constructor(
    private adapter: DatabaseAdapter,
    private signalFailure: (reason?: any) => void
  ) {}

  private rollback(err: any, errorCallback?: (error: any) => void) {
    const invokeErrorCallbackAndSignalFailure = () => {
      if (typeof errorCallback !== 'undefined') errorCallback(err)
      this.signalFailure(err)
    }

    this.adapter
      ._runUncoordinated({ sql: 'ROLLBACK' })
      .then(() => {
        invokeErrorCallbackAndSignalFailure()
      })
      .catch(() => invokeErrorCallbackAndSignalFailure())
  }

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
        this.rollback(err, errorCallback)
      })
  }

  run(
    statement: Statement,
    successCallback?: (tx: Transaction, result: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    // uses _runUncoordinated because we're in a transaction that already acquired the lock
    const prom = this.adapter._runUncoordinated(statement)
    this.invokeCallback(prom, successCallback, errorCallback)
  }

  query(
    statement: Statement,
    successCallback: (tx: Transaction, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    // uses _queryUncoordinated because we're in a transaction that already acquired the lock
    const prom = this.adapter._queryUncoordinated(statement)
    this.invokeCallback(prom, successCallback, errorCallback)
  }
}
