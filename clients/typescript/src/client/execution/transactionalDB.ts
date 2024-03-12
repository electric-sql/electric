import { RunResult, Transaction } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import { DB } from './db'
import * as z from 'zod'
import { Row, Statement } from '../../util'
import { Fields } from '../model/schema'
import { Transformation, transformFields } from '../conversions/input'
import { Converter } from '../conversions/converter'

export class TransactionalDB implements DB {
  constructor(
    private _tx: Transaction,
    private _fields: Fields,
    private _converter: Converter
  ) { }
  
  withTableSchema(fields: Fields) {
    return new TransactionalDB(this._tx, fields, this._converter)
  }

  run(
    statement: QueryBuilder,
    successCallback?: (db: DB, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    const { text, values } = statement.toParam()
    this._tx.run(
      { sql: text, args: values },
      (tx, res) => {
        if (typeof successCallback !== 'undefined')
          successCallback(
            new TransactionalDB(tx, this._fields, this._converter),
            res
          )
      },
      errorCallback
    )
  }

  query<Z>(
    statement: QueryBuilder,
    schema: z.ZodType<Z>,
    successCallback: (db: DB, res: Z[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    const { text, values } = statement.toParam()
    this._tx.query(
      { sql: text, args: values },
      (tx, rows) => {
        if (typeof successCallback !== 'undefined') {
          const objects = rows.map((row) => {
            // convert SQLite/PG values back to JS values
            // and then parse the transformed object
            // with the Zod schema to validate it
            const transformedRow = transformFields(
              row,
              this._fields,
              this._converter,
              Transformation.Decode
            )
            return schema.parse(transformedRow)
          })
          successCallback(
            new TransactionalDB(tx, this._fields, this._converter),
            objects
          )
        }
      },
      errorCallback
    )
  }

  raw(
    sql: Statement,
    successCallback?: (tx: DB, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ) {
    this._tx.query(
      sql,
      (tx, rows) => {
        if (typeof successCallback !== 'undefined') {
          successCallback(
            new TransactionalDB(tx, this._fields, this._converter),
            rows
          )
        }
      },
      errorCallback
    )
  }
}
