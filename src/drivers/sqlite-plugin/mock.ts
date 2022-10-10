import { AnyFunction, BindParams, DbName } from '../../util/types'
import { SQLitePlugin, SQLitePluginTransaction } from './index'
import { mockResults } from './results'

export abstract class MockSQLitePlugin implements SQLitePlugin {
  databaseFeatures: {
    isSQLitePluginDatabase: true
  }
  openDBs: {
    [key: DbName]: 'INIT' | 'OPEN'
  }

  constructor(dbName: DbName) {
    this.databaseFeatures = {
      isSQLitePluginDatabase: true
    }
    this.openDBs = {}
    this.openDBs[dbName] = 'OPEN'
  }

  addTransaction(tx: SQLitePluginTransaction): void {
    if (!!tx.success) {
      const results = mockResults([{i: 0}])

      tx.success([tx, results])
    }
  }

  readTransaction(txFn: AnyFunction, _error?: AnyFunction, success?: AnyFunction): void {
    const tx = new MockSQLitePluginTransaction(true, success)

    txFn(tx)

    this.addTransaction(tx)
  }
  transaction(txFn: AnyFunction, _error?: AnyFunction, success?: AnyFunction): void {
    const tx = new MockSQLitePluginTransaction(false, success)

    txFn(tx)

    this.addTransaction(tx)
  }

  sqlBatch(_stmts: string[], success?: AnyFunction, _error?: AnyFunction): void {
    if (success !== undefined) {
      success()
    }
  }
}

export class MockSQLitePluginTransaction implements SQLitePluginTransaction {
  readOnly: boolean
  successCallback?: AnyFunction

  constructor(readOnly: boolean = false, successCallback?: AnyFunction) {
    this.readOnly = readOnly
    this.successCallback = successCallback
  }

  success(...args: any[]): void {
    if (this.successCallback !== undefined) {
      this.successCallback(...args)
    }
  }

  addStatement(_sql: string, _values?: BindParams, success?: AnyFunction, _error?: AnyFunction): void {
    if (success !== undefined) {
      const results = mockResults([{i: 0}])
      const arg = this.readOnly ? [this, results] : undefined

      success(arg)
    }
  }

  executeSql(_sql: string, _values?: BindParams, success?: AnyFunction, _error?: AnyFunction): void {
    if (success !== undefined) {
      const results = mockResults([{i: 0}])

      success([this, results])
    }
  }
}
