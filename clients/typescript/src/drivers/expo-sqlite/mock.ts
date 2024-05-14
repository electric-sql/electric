import { Row } from '../../util/types'
import { type Query, type ResultSet, type SQLiteCallback } from 'expo-sqlite'
import { Database } from './database'

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
