import { DbName, Row } from '../../util/types'
import type {
  Database,
  SQLTransactionCallback,
  SQLTransactionErrorCallback,
  WebSQLDatabase,
  SQLiteCallback,
  Query,
} from 'expo-sqlite'
import {
  SQLResultSet as ResultSet,
  SQLStatementCallback,
  SQLStatementErrorCallback,
  SQLTransaction as Transaction,
} from 'expo-sqlite/src/SQLite.types'

export class MockDatabase implements Database {
  _name: DbName
  version: string

  constructor(dbName: DbName) {
    this._name = dbName
    this.version = '1.0'
  }

  transaction(
    _txFn: SQLTransactionCallback,
    _error?: SQLTransactionErrorCallback,
    successCallback?: () => void
  ): void {
    _txFn(new MockTransaction())
    if (successCallback !== undefined) {
      successCallback()
    }
  }

  readTransaction(
    _txFn: SQLTransactionCallback,
    _error?: SQLTransactionErrorCallback,
    successCallback?: () => void
  ): void {
    _txFn(new MockTransaction())
    if (successCallback !== undefined) {
      successCallback()
    }
  }
}

export class MockWebSQLDatabase extends MockDatabase implements WebSQLDatabase {
  exec(_queries: Query[], _readOnly: boolean, callback: SQLiteCallback): void {
    callback(null, [{ rowsAffected: 0, rows: [] }])
  }

  closeAsync(): void {}
  async deleteAsync(): Promise<void> {}
}

export class MockTransaction implements Transaction {
  executeSql(
    _sqlStatement: string,
    _args?: (number | string | null)[],
    callback?: SQLStatementCallback,
    _errorCallback?: SQLStatementErrorCallback
  ): void {
    if (typeof callback !== 'undefined') callback(this, mockResults([{ i: 0 }]))
  }
}

function mockResults(rows: Row[]): ResultSet {
  return {
    insertId: 1,
    rows: {
      item: (i: number) => rows[i],
      length: rows.length,
      _array: rows,
    },
    rowsAffected: 0,
  }
}
