import { AnyFunction, BindParams, DbName } from '../../util/types'
import { SQLitePlugin, SQLitePluginTransaction } from './index'

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
      tx.success('mocked!')
    }
  }

  readTransaction(_txFn: AnyFunction, _error?: AnyFunction, success?: AnyFunction): void {
    this.addTransaction(new MockSQLitePluginTransaction(true, success))
  }
  transaction(_txFn: AnyFunction, _error?: AnyFunction, success?: AnyFunction): void {
    this.addTransaction(new MockSQLitePluginTransaction(false, success))
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

  executeSql(_sql: string, _values?: BindParams, _success?: AnyFunction, _error?: AnyFunction): void {}
}
