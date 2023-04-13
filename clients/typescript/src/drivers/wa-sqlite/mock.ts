import { Database } from './database'
import { DbName, Statement } from '../../util'
import { QueryExecResult } from '../util/results'

export class MockDatabase implements Database {
  name: DbName
  fail: Error | undefined

  constructor(dbName: DbName, fail?: Error) {
    this.name = dbName
    this.fail = fail
  }

  async exec(_statement: Statement): Promise<QueryExecResult> {
    if (typeof this.fail !== 'undefined') throw this.fail

    const dbName = this.name

    return {
      columns: ['db', 'val'],
      values: [
        [dbName, 1],
        [dbName, 2],
      ],
    }
  }

  getRowsModified(): number {
    return 0
  }
}
