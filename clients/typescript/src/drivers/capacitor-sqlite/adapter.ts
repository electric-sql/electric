import { capSQLiteSet } from '@capacitor-community/sqlite'
import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
} from '../../electric/adapter'
import { Row, SqlValue, Statement } from '../../util'
import { Database } from './database'
import { Mutex } from 'async-mutex'

export class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  #txMutex: Mutex

  constructor(public db: Database) {
    super()
    this.#txMutex = new Mutex()
  }

  /**
   * Executes a single SQLite statement, without taking the lock and without wrapping it in a transaction.
   * @param statement:
   * @returns
   */
  async run({ sql, args }: Statement): Promise<RunResult> {
    const wrapInTransaction = false

    const result = await this.db.run(sql, args, wrapInTransaction)
    const rowsAffected = result.changes?.changes ?? 0
    return { rowsAffected }
  }

  /**
   * Runs one or more statements within a transaction block, taking the lock.
   * @param statements
   * @returns
   */
  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    const set: capSQLiteSet[] = statements.map(({ sql, args }) => ({
      statement: sql,
      values: (args ?? []) as SqlValue[],
    }))

    const wrapInTransaction = true

    const releaseMutex = await this.#txMutex.acquire()
    const result = await this.db.executeSet(set, wrapInTransaction)
    releaseMutex()

    const rowsAffected = result.changes?.changes ?? 0
    // TODO: unsure how capacitor-sqlite populates the changes value (additive?), and what is expected of electric here.
    return { rowsAffected }
  }

  /**
   * Queries a single statement, without taking the lock or wrapping in a transaction. Intended for select statements.
   * @param
   * @returns
   */
  async query({ sql, args }: Statement): Promise<Row[]> {
    const result = await this.db.query(sql, args)
    return result.values ?? []
  }

  // No async await on capacitor-sqlite promise-based APIs + the complexity of the transaction<T> API make for one ugly implementation...
  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    // Acquire mutex before even instantiating the transaction object.
    // This will ensure transactions cannot get interleaved.
    const releaseMutex = await this.#txMutex.acquire()
    return new Promise<T>((resolve, reject) => {
      // Convenience function. Rejecting should always release the acquired mutex.
      const releaseMutexAndReject = (err?: any) => {
        releaseMutex()
        reject(err)
      }

      this.db
        .beginTransaction()
        .then(() => {
          const wrappedTx = new WrappedTx(this)
          try {
            f(wrappedTx, (res) => {
              // Client calls this setResult function when done. Commit and resolve.
              this.db
                .commitTransaction()
                .then(() => {
                  releaseMutex()
                  resolve(res)
                })
                .catch((err) => releaseMutexAndReject(err))
            })
          } catch (err) {
            this.db
              .rollbackTransaction()
              .then(() => {
                releaseMutexAndReject(err)
              })
              .catch((err) => releaseMutexAndReject(err))
          }
        })
        .catch((err) => releaseMutexAndReject(err)) // Are all those catch -> rejects needed? Apparently, yes because of explicit promises. Tests confirm this.
    })
  }
}

// Did consider handling begin/commit/rollback transaction in this wrapper, but in the end it made more sense
// to do so within the transaction<T> implementation, promises bubble up naturally that way and no need for inTransaction flag.
class WrappedTx implements Tx {
  constructor(private adapter: DatabaseAdapter) {}

  run(
    statement: Statement,
    successCallback?: (tx: Tx, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.adapter
      .run(statement)
      .then((runResult) => {
        if (typeof successCallback !== 'undefined') {
          successCallback(this, runResult)
        }
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') {
          errorCallback(err)
        }
      })
  }

  query(
    statement: Statement,
    successCallback: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.adapter
      .query(statement)
      .then((result) => {
        if (typeof successCallback !== 'undefined') {
          successCallback(this, result)
        }
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') {
          errorCallback(err)
        }
      })
  }
}
