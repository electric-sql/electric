import { DatabaseAdapter, RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import { DB } from './db'
import * as z from 'zod'

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

  query<Z>(
    statement: string | QueryBuilder,
    schema: z.ZodType<Z>,
    successCallback: (db: DB<T>, res: Z[]) => void,
    errorCallback?: (error: any) => void
  ) {
    this._adapter
      .query({ sql: statement.toString() })
      .then((rows) => {
        if (typeof successCallback !== 'undefined') {
          try {
            const objects = rows.map((row) => schema.parse(row))
            successCallback(this, objects)
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
