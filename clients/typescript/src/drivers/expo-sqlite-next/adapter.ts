import { Row, SqlValue } from '../../util/types'
import { Statement } from '../../util'
import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
} from '../../electric/adapter'
import { Database } from './database'
import { Mutex } from 'async-mutex'

export class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  readonly db: Database
  protected txMutex: Mutex

  constructor(db: Database) {
    super()
    this.db = db
    this.txMutex = new Mutex()
  }

  async run(statement: Statement): Promise<RunResult> {
    await this.txMutex.waitForUnlock()
    return this._run(statement)
  }

  async query(statement: Statement): Promise<Row[]> {
    await this.txMutex.waitForUnlock()
    return this._query(statement)
  }

  async _run(statement: Statement): Promise<RunResult> {
    const { sql: source, args: params = [] } = statement
    const result = await this.db.runAsync(
      source,
      params as Omit<SqlValue, 'bigint'>
    )
    return {
      rowsAffected: result.changes,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    const { sql: source, args: params = [] } = statement
    return await this.db.getAllAsync(source, params as Omit<SqlValue, 'bigint'>)
  }

  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    const release = await this.txMutex.acquire()
    return new Promise<RunResult>((resolve, reject) => {
      this.db
        .withTransactionAsync(async () => {
          const results = await Promise.all(
            statements.map(this._run.bind(this))
          )
          const runResult = results.reduce((resA, resB) => ({
            rowsAffected: resA.rowsAffected + resB.rowsAffected,
          }))
          resolve(runResult)
        })
        .catch(reject)
    }).finally(release)
  }

  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    const release = await this.txMutex.acquire()
    return new Promise<T>((resolve, reject) => {
      this.db
        .withTransactionAsync(
          () =>
            new Promise((txnResolve, txnReject) => {
              const adaptedTxn = new WrappedTx(this, txnReject)
              f(adaptedTxn, (res) => {
                txnResolve()
                resolve(res)
              })
            })
        )
        .catch(reject)
    }).finally(release)
  }
}

class WrappedTx implements Tx {
  constructor(
    private tx: DatabaseAdapter,
    private signalFailure: (err: any) => void
  ) {}
  run(
    statement: Statement,
    successCallback?: (tx: Tx, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.tx
      ._run(statement)
      .then((res) => {
        successCallback?.(this, res)
      })
      .catch((err) => {
        errorCallback?.(err)
        this.signalFailure(err)
      })
  }

  query(
    statement: Statement,
    successCallback: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.tx
      ._query(statement)
      .then((res) => {
        successCallback?.(this, res)
      })
      .catch((err) => {
        errorCallback?.(err)
        this.signalFailure(err)
      })
  }
}
