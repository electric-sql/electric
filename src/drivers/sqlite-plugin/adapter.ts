import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { AnyFunction, Row, Statement } from '../../util/types'

import { SQLitePlugin, SQLitePluginTransaction } from './index'
import { ensurePromise } from './promise'
import { ExecutionResult, rowsFromResults } from './results'
import Log from 'loglevel'

export abstract class SQLitePluginDatabaseAdapter {
  db: SQLitePlugin
  promisesEnabled: boolean

  constructor(db: SQLitePlugin) {
    this.db = db
    this.promisesEnabled = false
  }

  async run(statement: Statement): Promise<void> {
    return this.runInTransaction(statement)
  }

  async runInTransaction(...statements: Statement[]): Promise<void> {
    const promisesEnabled = this.promisesEnabled
    const transaction = this.db.transaction.bind(this.db)

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const txFn = (tx: SQLitePluginTransaction) => {
        for (const { sql, args } of statements) {
          const stmtFailure = (err: any) => {
            Log.info('run statement failure', sql, err)
            reject(err)
          }
          tx.executeSql(sql, args, undefined, stmtFailure)
        }
      }

      const success = () => {
        resolve()
      }

      const failure = (err: any) => {
        Log.info('run tx failure')
        reject(err)
      }

      return promisesEnabled
        ? ensurePromise(transaction(txFn)).then(success).catch(failure)
        : transaction(txFn, failure, success)
    })
  }

  query({ sql, args }: Statement): Promise<Row[]> {
    const promisesEnabled = this.promisesEnabled
    const readTransaction = this.db.readTransaction.bind(this.db)

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = ([_tx, results]: ExecutionResult) => {
        resolve(rowsFromResults(results))
      }

      const txFn = (tx: SQLitePluginTransaction) => {
        return promisesEnabled
          ? ensurePromise(tx.executeSql(sql, args)).then(success).catch(reject)
          : tx.executeSql(sql, args, success, reject)
      }

      readTransaction(txFn)
    })
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}
