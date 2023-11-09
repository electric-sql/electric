import { Row } from '../../util/types.js'
import {
  Query,
  ResultSet,
  SQLiteCallback,
} from 'expo-sqlite/src/SQLite.types.js'
import { Database } from './database.js'

export class MockDatabase implements Database {
  constructor(public _name: string) {}

  execRawQuery(
    _queries: Query[],
    _readOnly: boolean,
    callback: SQLiteCallback
  ): void {
    callback(null, [mockResults([{ i: 0 }])])
  }

  getRowsModified() {
    return 0
  }
}

function mockResults(rows: Row[]): ResultSet {
  return {
    insertId: 1,
    rows: rows,
    rowsAffected: 0,
  }
}
