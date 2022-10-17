import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { AnyFunction, Row, Statement } from '../../util/types'

import { Results, rowsFromResults } from '../sqlite-plugin/results'
import { Database, Transaction } from './database'

export class DatabaseAdapter {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  runTransaction(...statements: Statement[]): Promise<void> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const txFn = (tx: Transaction) => {        
        for (const { sql, args } of statements) {
          tx.executeSql(sql, args ? args as any : [])
        }
      }
      this.db.transaction(txFn, reject, resolve)
    })
  }

  run(statement: Statement): Promise<void> {
    return this.runTransaction(statement)
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
          reject)
      }

      this.db.readTransaction(txFn)
    })
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}
