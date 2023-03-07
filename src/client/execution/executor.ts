import { DatabaseAdapter, RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import { ZObject } from '../validation/schemas'
import { DB } from './db'
import { TransactionalDB } from './transactionalDB'
import { NonTransactionalDB } from './nonTransactionalDB'
import { Notifier } from '../../notifiers'

export class Executor<T> {
  constructor(
    private _adapter: DatabaseAdapter,
    private _schema: ZObject<T>,
    private _notifier: Notifier
  ) {}

  async runInTransaction(...qs: QueryBuilder[]): Promise<RunResult> {
    const stmts = qs.map((q) => {
      return { sql: q.toString() }
    })

    const prom = this._adapter.runInTransaction(...stmts)

    // Fire a potentiallyChanged event when the transaction executed successfully
    prom.then((_res) => {
      this._notifier.potentiallyChanged()
    })

    return prom
  }

  // Executes the given function within a transaction
  async transaction<T, A>(
    f: (
      db: DB<T>,
      setResult: (res: A) => void,
      onError: (err: any) => void
    ) => void
  ): Promise<A> {
    // We cast the result to `Promise<A>` because we force ourselves to always use `setResult`
    // and thus the promise will always be resolved with the value that was passed to `setResult` which is of type `A`
    return (await this._adapter.transaction((tx, setResult) =>
      f(
        new TransactionalDB<T>(tx, this._schema as unknown as ZObject<T>),
        (res) => {
          setResult(res)
          this._notifier.potentiallyChanged() // inform the notifier that the data may have changed
        },
        () => {
          // ignore it, errors are already caught by the adapter and will reject the promise
        }
      )
    )) as unknown as Promise<A>
  }

  // Executes the given function without starting a new transaction
  async execute<T, A>(
    f: (
      db: DB<T>,
      setResult: (res: A) => void,
      onError: (err: any) => void
    ) => void
  ): Promise<A> {
    return new Promise((resolve, reject) => {
      f(
        new NonTransactionalDB(this._adapter),
        (res) => {
          resolve(res)
          this._notifier.potentiallyChanged() // inform the notifier that the data may have changed
        },
        reject
      )
    })
  }
}
