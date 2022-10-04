import { AnyFunction, BindParams, DbName, Row } from '../../util/types'
import { SQLitePlugin, SQLitePluginTransaction } from './index'
import { Results } from './results'

export const mockResults: Results = {
  rows: {
    length: 1,
    item(i: number): Row {
      return {i: i}
    },
    raw(): Row[] {
      return [{i: 0}]
    }
  },
  rowsAffected: 0
}

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
      tx.success([tx, mockResults])
    }
  }

  readTransaction(_txFn: AnyFunction, _error?: AnyFunction, success?: AnyFunction): void {
    this.addTransaction(new MockSQLitePluginTransaction(true, success))
  }
  transaction(_txFn: AnyFunction, _error?: AnyFunction, success?: AnyFunction): void {
    this.addTransaction(new MockSQLitePluginTransaction(false, success))
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

  executeSql(_sql: string, _values?: BindParams, _success?: AnyFunction, _error?: AnyFunction): void {}
}
