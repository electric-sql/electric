import { RunResult, Transaction } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import { DB } from './db'
import * as z from 'zod'
import { Row, Statement } from '../../util'

export class TransactionalDB implements DB {
  constructor(private _tx: Transaction) {}
  run(
    statement: QueryBuilder | string,
    successCallback?: (db: DB, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    this._tx.run(
      { sql: statement.toString() },
      (tx, res) => {
        if (typeof successCallback !== 'undefined')
          successCallback(new TransactionalDB(tx), res)
      },
      errorCallback
    )
  }

  query<Z>(
    statement: QueryBuilder | string,
    schema: z.ZodType<Z>,
    successCallback: (db: DB, res: Z[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this._tx.query(
      { sql: statement.toString() },
      (tx, rows) => {
        if (typeof successCallback !== 'undefined') {
          const objects = rows.map((row) => schema.parse(row)) //.partial().parse(row))
          successCallback(new TransactionalDB(tx), objects)
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
          successCallback(new TransactionalDB(tx), rows)
        }
      },
      errorCallback
    )
  }
}
