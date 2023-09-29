import { capSQLiteChanges, capSQLiteSet } from '@capacitor-community/sqlite'
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

  async run({ sql, args }: Statement): Promise<RunResult> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `capacitor-sqlite doesn't support named query parameters, use positional parameters instead`
      )
    }

    const wrapInTransaction = false // Default is true. electric calls run from within transaction<T> so we need to disable transactions here.

    const result = await this.db.run(sql, args, wrapInTransaction)
    const rowsAffected = result.changes?.changes ?? 0
    return { rowsAffected }
  }

  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    if (statements.some((x) => x.args && !Array.isArray(x.args))) {
      throw new Error(
        `capacitor-sqlite doesn't support named query parameters, use positional parameters instead`
      )
    }

    const set: capSQLiteSet[] = statements.map(({ sql, args }) => ({
      statement: sql,
      values: args as SqlValue[] | undefined,
    }))

    const wrapInTransaction = true
    const result = await this.db.executeSet(set, wrapInTransaction)
    const rowsAffected = result.changes?.changes ?? 0
    // TODO: unsure how capacitor-sqlite populates the changes value (additive?), and what is expected of electric here.
    return { rowsAffected }
  }

  async query({ sql, args }: Statement): Promise<Row[]> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `capacitor-sqlite doesn't support named query parameters, use positional parameters instead`
      )
    }
    const result = await this.db.query(sql, args)
    return result.values ?? []
  }

  // No async await on capacitor-sqlite promise-based APIs + the complexity of the transaction<T> API make for one ugly implementation...
  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    const releaseMutex = await this.#txMutex.acquire()
    return new Promise<T>((resolve, reject) => {
      const releaseMutexAndReject = (err?: any) => {
        // if the tx is rolled back, release the lock and reject the promise
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
