import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { AnyFunction, Row, Statement } from '../../util/types'

import { Results, rowsFromResults } from '../generic/results'
import { Database, Transaction } from './database'
import {
  DatabaseAdapter as DatabaseAdapterInterface,
  Transaction as Tx,
} from '../../electric/adapter'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  runInTransaction(...statements: Statement[]): Promise<void> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const txFn = (tx: Transaction) => {
        for (const { sql, args } of statements) {
          tx.executeSql(sql, args ? (args as any) : [])
        }
      }
      this.db.transaction(txFn, reject, resolve)
    })
  }

  transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T | void> {
    let result: T | void = undefined
    return new Promise<void>((resolve, reject) => {
      const wrappedFn = (tx: Transaction) => {
        f(new WrappedTx(tx), (res) => (result = res))
      }
      this.db.transaction(wrappedFn, reject, resolve)
    }).then(() => result)
  }

  run(statement: Statement): Promise<void> {
    return this.runInTransaction(statement)
  }

  query({ sql, args }: Statement): Promise<Row[]> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = (_tx: Transaction, results: Results) => {
        resolve(rowsFromResults(results))
      }
      const txFn = (tx: Transaction) => {
        tx.executeSql(
          sql,
          args as unknown as (number | string | null)[],
          success,
          reject
        )
      }

      this.db.readTransaction(txFn)
    })
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}

class WrappedTx implements Tx {
  constructor(private tx: Transaction) {}

  run(
    statement: Statement,
    successCallback?: (tx: Tx) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.executeSQL(
      statement,
      (tx, _res) => {
        if (typeof successCallback !== 'undefined') successCallback(tx)
      },
      errorCallback
    )
  }

  query(
    statement: Statement,
    successCallback: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.executeSQL(statement, successCallback, errorCallback)
  }

  private executeSQL(
    { sql, args }: Statement,
    successCallback?: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ) {
    this.tx.executeSql(
      sql,
      args ? (args as any) : [],
      (tx, res) => {
        if (typeof successCallback !== 'undefined')
          successCallback(new WrappedTx(tx), rowsFromResults(res))
      },
      (_tx, err) => {
        if (typeof errorCallback !== 'undefined') errorCallback(err)
        return true
      }
    )
  }
}
