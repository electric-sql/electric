import { DatabaseAdapter, RunResult } from '../../electric/adapter'
import { QueryBuilder, ToParamOptions } from 'squel'
import { DB } from './db'
import * as z from 'zod'
import { Row, Statement } from '../../util'

export class NonTransactionalDB implements DB {
  constructor(private _adapter: DatabaseAdapter) {}

  run(
    statement: QueryBuilder,
    successCallback?: (db: DB, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ) {
    const { text, values } = statement.toParam({
      numberedParameters: false,
    } as unknown as ToParamOptions)
    this._adapter
      .run({ sql: text, args: values })
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
    statement: QueryBuilder,
    schema: z.ZodType<Z>,
    successCallback: (db: DB, res: Z[]) => void,
    errorCallback?: (error: any) => void
  ) {
    const { text, values } = statement.toParam({
      numberedParameters: false,
    } as unknown as ToParamOptions)
    this._adapter
      .query({ sql: text, args: values })
      .then((rows) => {
        try {
          const objects = rows.map((row) => schema.parse(row))
          successCallback(this, objects)
        } catch (err) {
          if (typeof errorCallback !== 'undefined') {
            errorCallback(err)
          }
        }
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') {
          errorCallback(err)
        }
      })
  }

  raw(
    sql: Statement,
    successCallback?: (tx: DB, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ) {
    this._adapter
      .query(sql)
      .then((rows) => {
        if (typeof successCallback !== 'undefined') {
          successCallback(this, rows)
        }
      })
      .catch((err) => {
        if (typeof errorCallback !== 'undefined') {
          errorCallback(err)
        }
      })
  }
}
