import { BindParams, DbName, Row } from '../../util/types'
import { Database, Info, Statement } from './database'

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

  run(_params: BindParams): Info {
    return {
      changes: 0,
      lastInsertRowid: 1234
    }
  }

  get(_params: BindParams): Row | void {
    return {foo: 'bar'}
  }

  all(params: BindParams): Row[] {
    if (params && 'shouldError' in params && params.shouldError) {
      throw new Error('Mock query error')
    }

    return [{foo: 'bar'}, {foo: 'baz'}]
  }

  iterate(_params: BindParams): Iterable<Row> {
    return [{foo: 'bar'}, {foo: 'baz'}]
  }
}
