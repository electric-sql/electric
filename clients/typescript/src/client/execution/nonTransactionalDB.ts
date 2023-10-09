import { DatabaseAdapter, RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import { DB } from './db'
import * as z from 'zod'
import { Row, Statement } from '../../util'
import { Transformation, transformFields } from '../conversions/input'
import { Fields } from '../model/schema'

export class NonTransactionalDB implements DB {
  constructor(private _adapter: DatabaseAdapter, private _fields: Fields) {}

  run(
    statement: QueryBuilder,
    successCallback?: (db: DB, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ) {
    const { text, values } = statement.toParam({ numberedParameters: false })
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
    const { text, values } = statement.toParam({ numberedParameters: false })
    this._adapter
      .query({ sql: text, args: values })
      .then((rows) => {
        try {
          const objects = rows.map((row) => {
            // convert SQLite values back to JS values
            // and then parse the transformed object
            // with the Zod schema to validate it
            const transformedRow = transformFields(
              row,
              this._fields,
              Transformation.Sqlite2Js
            )
            return schema.parse(transformedRow)
          })
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
