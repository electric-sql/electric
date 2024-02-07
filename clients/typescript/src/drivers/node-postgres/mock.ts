import { Database, QueryResult } from './database'
import { DbName, Statement } from '../../util'

export class MockDatabase implements Database {
  name: DbName
  fail: Error | undefined

  constructor(dbName: DbName, fail?: Error) {
    this.name = dbName
    this.fail = fail
  }

  async exec(_statement: Statement): Promise<QueryResult> {
    if (typeof this.fail !== 'undefined') throw this.fail

    return {
      rows: [{ val: 1 }, { val: 2 }],
      rowsModified: 0,
    }
  }
}
