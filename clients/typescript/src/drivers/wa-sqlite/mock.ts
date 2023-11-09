import { DbName, Row, Statement } from '../../util/index.js'

export class MockDatabase {
  name: DbName
  fail: Error | undefined

  constructor(dbName: DbName, fail?: Error) {
    this.name = dbName
    this.fail = fail
  }

  async exec(_statement: Statement): Promise<Row[]> {
    if (typeof this.fail !== 'undefined') throw this.fail

    const dbName = this.name

    return [
      { db: dbName, val: 1 },
      { db: dbName, val: 2 },
    ]
  }

  getRowsModified(): number {
    return 0
  }
}
