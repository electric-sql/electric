import { DbName, Row } from '../../util/types'
import { Database, Info, Statement, StatementBindParams } from './database'

export class MockDatabase implements Database {
  name: DbName

  inTransaction = false
  memory = false

  constructor(name: DbName) {
    this.name = name
  }

  exec(_sql: string): Database {
    return this
  }

  prepare(_sql: string): Statement {
    return new MockStatement(this)
  }

  transaction(fn: (...args: any[]) => any): (...args: any[]) => any {
    const self = this

    function txFn(...args: any[]) {
      self.inTransaction = true

      const retval = fn(...args)

      self.inTransaction = false

      return retval
    }
    txFn.deferred = () => {}
    txFn.immediate = () => {}
    txFn.exclusive = () => {}

    return txFn
  }
}

export class MockStatement implements Statement {
  database: Database
  readonly = false
  source = 'select foo from bar'

  constructor(db: Database) {
    this.database = db
  }

  run(..._params: StatementBindParams): Info {
    return {
      changes: 0,
      lastInsertRowid: 1234,
    }
  }

  get(..._params: StatementBindParams): Row | void {
    return { foo: 'bar' }
  }

  all(...params: StatementBindParams): Row[] {
    if (
      typeof params[0] == 'object' &&
      params[0] &&
      'shouldError' in params[0]
    ) {
      throw new Error('Mock query error')
    }

    return [{ foo: 'bar' }, { foo: 'baz' }]
  }

  iterate(..._params: StatementBindParams): Iterable<Row> {
    return [{ foo: 'bar' }, { foo: 'baz' }]
  }
}
