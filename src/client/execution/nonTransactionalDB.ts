import { DatabaseAdapter, RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import { DB } from './db'

export class NonTransactionalDB<T> implements DB<T> {
  constructor(private _adapter: DatabaseAdapter) {}

  run(
    statement: string | QueryBuilder,
    successCallback?: (db: DB<T>, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ) {
    this._adapter
      .run({ sql: statement.toString() })
      .then((res) => {
        if (typeof successCallback !== 'undefined') {
          try {
            successCallback(this, res)
          } catch (err) {
            if (typeof errorCallback !== 'undefined') {
              errorCallback(err)
            }
          }
        }
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') {
          errorCallback(err)
        }
      })
  }

  query(
    statement: string | QueryBuilder,
    successCallback: (db: DB<T>, res: Partial<T>[]) => void,
    errorCallback?: (error: any) => void
  ) {
    this._adapter
      .query({ sql: statement.toString() })
      .then((rows) => {
        if (typeof successCallback !== 'undefined') {
          try {
            successCallback(this, rows as unknown as Partial<T>[])
          } catch (err) {
            if (typeof errorCallback !== 'undefined') {
              errorCallback(err)
            }
          }
        }
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') {
          errorCallback(err)
        }
      })
  }
}
