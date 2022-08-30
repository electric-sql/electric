import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { AnyFunction, BindParams, DbNamespace, Row } from '../../util/types'

import { SQLitePlugin, SQLitePluginTransaction } from './index'
import { ensurePromise } from './promise'
import { ExecutionResult, rowsFromResults } from './results'

export abstract class SQLitePluginQueryAdapter {
  db: SQLitePlugin
  defaultNamespace: DbNamespace
  promisesEnabled: boolean

  constructor(db: SQLitePlugin, defaultNamespace: DbNamespace) {
    this.db = db
    this.defaultNamespace = defaultNamespace
    this.promisesEnabled = false
  }

  perform(query: string, bindParams: BindParams = []): Promise<Row[]> {
    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const success = ([_tx, results]: ExecutionResult) => {
        resolve(rowsFromResults(results))
      }
      const error = (err: any) => reject(err)
      const txFn = (tx: SQLitePluginTransaction) => tx.executeSql(query, bindParams)

      const run = this.db.readTransaction
      if (this.promisesEnabled) {
        const retval = run(txFn)
        const retvalPromise = ensurePromise(retval)

        retvalPromise
          .then(success)
          .catch(error)
      }
      else { // The callback args are reversed!
        run(txFn, error, success)
      }
    })
  }

  tableNames(query: string): QualifiedTablename[] {
    return parseTableNames(query, this.defaultNamespace)
  }
}
