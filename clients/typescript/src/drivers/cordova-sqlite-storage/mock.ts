import { DbName, Row } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  dbname: DbName

  constructor(dbName: DbName) {
    this.dbname = dbName
  }

  transaction(
    fn: SQLitePlugin.TransactionFunction,
    _error?: SQLitePlugin.ErrorCallback | undefined,
    success?: SQLitePlugin.SuccessCallback | undefined
  ): void {
    fn(new MockTransaction(false))
    if (success) return void success()
  }

  readTransaction(
    fn: SQLitePlugin.TransactionFunction,
    _error?: SQLitePlugin.ErrorCallback | undefined,
    success?: SQLitePlugin.SuccessCallback | undefined
  ): void {
    fn(new MockTransaction(true))
    if (success) return void success()
  }

  executeSql(
    statement: string,
    params?: any[] | undefined,
    success?: SQLitePlugin.StatementSuccessCallback | undefined,
    error?: SQLitePlugin.ErrorCallback | undefined
  ): void {
    new MockTransaction(false).executeSql(
      statement,
      params,
      (_, results) => success && success(results),
      (_, err) => error && error(err)
    )
  }

  sqlBatch(
    _sqlStatements: (string | [string, any[]])[],
    success?: SQLitePlugin.SuccessCallback | undefined,
    _error?: SQLitePlugin.ErrorCallback | undefined
  ): void {
    if (success) return void success()
  }
}

class MockTransaction implements SQLitePlugin.Transaction {
  constructor(public readonly: boolean) {}

  executeSql(
    _statement: string,
    _params?: any[] | undefined,
    success?: SQLitePlugin.TransactionStatementSuccessCallback | undefined,
    _error?: SQLitePlugin.TransactionStatementErrorCallback | undefined
  ): void {
    if (success !== undefined) {
      const results = mockResults([{ i: 0 }])

      success(this, results)
    }
  }
}

function mockResults(rows: Row[]): SQLitePlugin.Results {
  return {
    rows: {
      item: (i: number) => rows[i],
      length: rows.length,
    },
    rowsAffected: 0,
  }
}
