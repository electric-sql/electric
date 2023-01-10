import { DbName } from '../../util/types'

import {
  NamedExpoDatabase,
  NamedWebSQLDatabase,
  Query,
  SQLiteCallback,
  TransactionCallback,
  TransactionErrorCallback,
} from './database'

export class MockDatabase implements NamedExpoDatabase {
  _name: DbName
  version: string

  constructor(dbName: DbName) {
    this._name = dbName
    this.version = '1.0'
  }

  transaction(
    _txFn: TransactionCallback,
    _error?: TransactionErrorCallback,
    successCallback?: () => void
  ): void {
    if (successCallback !== undefined) {
      successCallback()
    }
  }

  readTransaction(
    _txFn: TransactionCallback,
    _error?: TransactionErrorCallback,
    successCallback?: () => void
  ): void {
    if (successCallback !== undefined) {
      successCallback()
    }
  }
}

export class MockWebSQLDatabase
  extends MockDatabase
  implements NamedWebSQLDatabase
{
  exec(_queries: Query[], _readOnly: boolean, callback: SQLiteCallback): void {
    callback(null, [{ rowsAffected: 0, rows: [] }])
  }

  closeAsync(): void {}
  async deleteAsync(): Promise<void> {}
}
