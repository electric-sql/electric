import {
  DatabaseAdapter as DatabaseAdapterInterface,
  Transaction as Tx,
} from '../../electric/adapter'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { Row, Statement } from '../../util/types'

import { Database } from './database'
import { resultToRows } from './result'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }
  async runInTransaction(...statements: Statement[]): Promise<void> {
    let open = false
    try {
      // SQL-js accepts multiple statements in a string and does
      // not run them as transaction.
      await this.db.run('BEGIN')
      open = true
      for (const stmt of statements) {
        await this.db.run(stmt.sql, stmt.args)
      }
    } catch (error) {
      await this.db.run('ROLLBACK')
      open = false
      throw error // rejects the promise with the reason for the rollback
    } finally {
      if (open) {
        await this.db.run('COMMIT')
      }
    }
  }

  transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T | void> {
    return new Promise((resolve, reject) => {
      this.run({ sql: 'BEGIN' })
        .then(() => {
          // Committing or rolling back will be done by the wrapped transaction after which it will resolve or reject the promise.
          // We can't commit/rollback here after executing `f` (similarly to `runInTransaction`) because `f` returns before the queries have executed (since the queries are asynchronous).
          // Hence, we would always call `COMMIT` after executing `f` so it could be that `COMMIT` is executed before the queries from the transaction are executed.
          // It could even be that we `COMMIT` and then one of the transaction's queries fails, the failure is caught and we call `ROLLBACK`
          // which at that point is not possible since we already committed.
          // This can be avoided if we were able to `await` the execution of `f` but that would require `f` to return a promise.
          // Promisifying the transaction is not possible because promises are not compatible with the cordova-sqlite-storage, react-native-sqlite-storage, and expo-sqlite drivers.
          const wrappedTx = new WrappedTx(this, reject)
          f(wrappedTx, (res) => {
            // Commit the transaction when the user sets the result.
            // This assumes that the user does not execute any more queries after setting the result.
            this.run({ sql: 'COMMIT' })
              .then(() => resolve(res))
              .catch(reject)
          })
        })
        .catch(reject)
    })
  }

  async run(statement: Statement): Promise<void> {
    const prepared = await this.db.prepare(statement.sql)
    await prepared.run(statement.args ? statement.args : [])
  }

  async query(statement: Statement): Promise<Row[]> {
    const result = await this.db.exec(statement.sql, statement.args)
    return resultToRows(result)
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}

class WrappedTx implements Tx {
  constructor(
    private adapter: DatabaseAdapter,
    private reject: (reason?: any) => void
  ) {}

  private rollback(err: any, errorCallback?: (error: any) => void) {
    const invokeErrorCallbackAndReject = () => {
      if (typeof errorCallback !== 'undefined') errorCallback(err)
      this.reject(err)
    }

    this.adapter
      .run({ sql: 'ROLLBACK' })
      .then(() => {
        console.log('Rolled back')
        invokeErrorCallbackAndReject()
      })
      .catch(() => invokeErrorCallbackAndReject())
  }

  run(
    statement: Statement,
    successCallback?: (tx: WrappedTx) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.adapter
      .run(statement)
      .then(() => {
        if (typeof successCallback !== 'undefined') {
          successCallback(this)
        }
      })
      .catch((err) => {
        this.rollback(err, errorCallback)
      })
  }

  query(
    statement: Statement,
    successCallback: (tx: WrappedTx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.adapter
      .query(statement)
      .then((rows) => {
        successCallback(this, rows)
      })
      .catch((err) => {
        this.rollback(err, errorCallback)
      })
  }
}
