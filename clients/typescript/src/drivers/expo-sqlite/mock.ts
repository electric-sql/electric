import { Row } from '../../util/types'
import {
  Query,
  SQLResultSet as ResultSet,
  SQLStatementCallback,
  SQLStatementErrorCallback,
  SQLiteCallback,
  SQLTransaction as Transaction,
} from 'expo-sqlite/src/SQLite.types'
import { OriginalDatabase } from './database'

export class MockDatabase implements OriginalDatabase {
  constructor(public _name: string) {}

  execRawQuery(
    _queries: Query[],
    _readOnly: boolean,
    callback: SQLiteCallback
  ): void {
    callback(null, [
      {
        rowsAffected: 0,
        rows: [],
      },
    ])
  }

  getRowsModified() {
    return 0
  }
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
