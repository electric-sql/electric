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

  _transaction(txFn: AnyFunction, readOnly: boolean, success?: AnyFunction, error?: AnyFunction): void {
    const run = readOnly
      ? this.db.readTransaction.bind(this.db)
      : this.db.transaction.bind(this.db)

    if (this.promisesEnabled) {
      ensurePromise(run(txFn)).then(success).catch(error)
    }
    else { // The callback args are reversed!
      run(txFn, error, success)
    }
  }

  _readTransaction(txFn: AnyFunction, success?: AnyFunction, error?: AnyFunction): void {
    this._transaction(txFn, true, success, error)
  }

  run(sql: string): Promise<void> {
    const promisesEnabled = this.promisesEnabled
    const runBatch = this.db.sqlBatch.bind(this.db)

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = () => {
        console.log('SQLitePluginDatabaseAdapter.run success', sql)

        resolve()
      }
      const error = (err: any) => {
        console.log('SQLitePluginDatabaseAdapter.run error', sql, err)

        reject(err)
      }

      const stmts: string[] = sql.split(';')

      if (promisesEnabled) {
        ensurePromise(runBatch(stmts))
          .then(success)
          .catch(error)
      }
      else {
        runBatch(stmts, success, error)
      }
    })
  }

  query(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const promisesEnabled = this.promisesEnabled
    const read = this._readTransaction.bind(this)

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = ([_tx, results]: ExecutionResult) => {
        console.log('SQLitePluginDatabaseAdapter.query success', sql, bindParams, results)

        resolve(rowsFromResults(results))
      }
      const error = (err: any) => {
        console.log('SQLitePluginDatabaseAdapter.query error', err)

        reject(err)
      }

      const txFn = (tx: SQLitePluginTransaction) => {
        if (promisesEnabled) {
          ensurePromise(tx.executeSql(sql, bindParams))
            .then(success)
            .catch(error)
        }
        else {
          tx.executeSql(sql, bindParams, success, error)
        }
      }

      read(txFn)
    })
  }

  tableNames(query: string): QualifiedTablename[] {
    return parseTableNames(query)
  }
}
