
import { BindParams, Database, Info, Row, Statement } from './index'

export class MockDatabase implements Database {
  name: string

  inTransaction = false
  memory = false

  constructor(name: string) {
    this.name = name
  }

  exec(sql: string): Database {
    return this
  }

  prepare(sql: string): Statement {
    return new MockStatement(this)
  }

  transaction(fn: (...args: any[]) => any): (...args: any[]) => any {
    const self = this

    return (...args) => {
      self.inTransaction = true

      const retval = fn(...args)

      self.inTransaction = false

      return retval
    }
  }
}

export class MockStatement implements Statement {
  database: Database
  readonly = false

  constructor(db: Database) {
    this.database = db
  }

  run(bindParams: BindParams): Info {
    return {
      changes: 0,
      lastInsertRowid: 1234
    }
  }

  get(bindParams: BindParams): Row | void {}

  all(bindParams: BindParams): Row[] {
    return []
  }

  iterate(bindParams: BindParams): Iterable<Row> {
    return []
  }
}
