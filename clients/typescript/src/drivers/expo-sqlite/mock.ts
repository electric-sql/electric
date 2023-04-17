import { DbName } from '../../util/types'
import type {
  Database,
  SQLTransactionCallback,
  SQLTransactionErrorCallback,
  WebSQLDatabase,
  SQLiteCallback,
  Query,
} from 'expo-sqlite'
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
    if (successCallback !== undefined) {
      successCallback()
    }
  }

  readTransaction(
    _txFn: SQLTransactionCallback,
    _error?: SQLTransactionErrorCallback,
    successCallback?: () => void
  ): void {
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
