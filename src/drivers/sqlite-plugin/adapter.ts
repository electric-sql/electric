import { parseSqlIntoStatements, parseTableNames } from '../../util/parser'
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

  run(sql: string, bindParams: BindParams = []): Promise<void> {
    const promisesEnabled = this.promisesEnabled
    const transaction = this.db.transaction.bind(this.db)

    const stmts = parseSqlIntoStatements(sql)

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const txFn = (tx: SQLitePluginTransaction) => {
        // stmts.forEach(stmt => tx.addStatement(stmt, bindParams, undefined, reject))
        for (let i = 0; i < stmts.length; i++) {
          const stmtSuccess = () => {
            // console.log('run statement success', i, stmts[i])
          }

          const stmtfailure = (err: any) => {
            console.log('run statement failure', i, stmts[i], err)

            reject(err)
          }

          tx.addStatement(stmts[i], bindParams, stmtSuccess, stmtfailure)
        }
      }

      const success = () => {
        // console.log('run tx success')

        resolve()
      }

      const failure = (err: any) => {
        console.log('run tx failure')

        reject(err)
      }

      return promisesEnabled
        ? ensurePromise(transaction(txFn)).then(success).catch(failure)
        : transaction(txFn, failure, success)
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
