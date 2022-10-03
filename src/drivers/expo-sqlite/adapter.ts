import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { AnyFunction, BindParams, Row } from '../../util/types'

import { Results, rowsFromResults } from '../sqlite-plugin/results'
import { Database, Query, Transaction } from './database'

export class DatabaseAdapter {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  run(sql: string): Promise<void> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const txFn = (tx: Transaction) => {
        tx.executeSql(sql)
      }

      this.db.transaction(txFn, resolve, reject)
    })
  }

  query(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const args = bindParams as unknown as (number | string | null)[]

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = (_tx: Transaction, results: Results) => {
        resolve(rowsFromResults(results))
      }
      const txFn = (tx: Transaction) => {
        tx.executeSql(sql, args, success, reject)
      }

      this.db.readTransaction(txFn)
    })
  }

  tableNames(query: string | Query): QualifiedTablename[] {
    const sql = typeof query === 'string' ? query : query.sql

    return parseTableNames(sql)
  }
}
