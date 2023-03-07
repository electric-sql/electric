import { RunResult, Transaction } from '../../electric/adapter'
import { ZObject } from '../validation/schemas'
import { QueryBuilder } from 'squel'
import { DB } from './db'

export class TransactionalDB<T> implements DB<T> {
  constructor(private _tx: Transaction, private _schema: ZObject<T>) {}
  run(
    statement: QueryBuilder | string,
    successCallback?: (db: DB<T>, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    this._tx.run(
      { sql: statement.toString() },
      (tx, res) => {
        if (typeof successCallback !== 'undefined')
          successCallback(new TransactionalDB(tx, this._schema), res)
      },
      errorCallback
    )
  }

  query(
    statement: QueryBuilder | string,
    successCallback: (db: DB<T>, res: Partial<T>[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this._tx.query(
      { sql: statement.toString() },
      (tx, rows) => {
        if (typeof successCallback !== 'undefined') {
          const objects = rows.map((row) => this._schema.partial().parse(row))
          const typedObjects = objects as unknown as Partial<T>[] // if the row gets parsed it must be of type Partial<T>
          successCallback(new TransactionalDB(tx, this._schema), typedObjects)
        }
      },
      errorCallback
    )
  }
}
