import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { AnyFunction, BindParams, Row } from '../../util/types'

import { SQLitePlugin, SQLitePluginTransaction } from './index'
import { ensurePromise } from './promise'
import { ExecutionResult, rowsFromResults } from './results'

export abstract class SQLitePluginDatabaseAdapter {
  db: SQLitePlugin
  promisesEnabled: boolean

  constructor(db: SQLitePlugin) {
    this.db = db
    this.promisesEnabled = false
  }

  run(sql: string): Promise<void> {
    const promisesEnabled = this.promisesEnabled
    const runBatch = this.db.sqlBatch.bind(this.db)
    const stmts: string[] = sql.split(';')

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      promisesEnabled
        ? ensurePromise(runBatch(stmts)).then(resolve).catch(reject)
        : runBatch(stmts, resolve, reject)
    })
  }

  query(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const promisesEnabled = this.promisesEnabled
    const readTransaction = this.db.readTransaction.bind(this.db)

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = ([_tx, results]: ExecutionResult) => {
        resolve(rowsFromResults(results))
      }

      const txFn = (tx: SQLitePluginTransaction) => {
        return promisesEnabled
          ? ensurePromise(tx.executeSql(sql, bindParams)).then(success).catch(reject)
          : tx.executeSql(sql, bindParams, success, reject)
      }

      readTransaction(txFn)
    })
  }

  tableNames(query: string): QualifiedTablename[] {
    return parseTableNames(query)
  }
}
