import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  Transaction as Tx,
} from '../../electric/adapter'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import {
  Statement as DbStatement,
  Row,
  Statement,
  BindParams,
} from '../../util/types'

import { Database, StatementBindParams } from './database'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  async runInTransaction(...statements: DbStatement[]): Promise<RunResult> {
    const txn = this.db.transaction((stmts: DbStatement[]) => {
      let rowsAffected = 0
      for (const stmt of stmts) {
        const prep = this.db.prepare(stmt.sql)
        const res = prep.run(...wrapBindParams(stmt.args))
        rowsAffected += res.changes // increment by the total number of rows that were inserted, updated, or deleted by this operation
      }
      return {
        rowsAffected: rowsAffected,
      }
    })
    return txn(statements)
  }

  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T | void> {
    let result: T | void = undefined
    const txn = this.db.transaction(f)
    txn(new WrappedTx(this.db), (res) => (result = res))
    return result
  }

  // Promise interface, but impl not actually async
  async run({ sql, args }: DbStatement): Promise<RunResult> {
    const prep = this.db.prepare(sql)
    const res = prep.run(...wrapBindParams(args))
    return {
      rowsAffected: res.changes,
    }
  }

  async query({ sql, args }: DbStatement): Promise<Row[]> {
    const stmt = this.db.prepare(sql)
    return stmt.all(...wrapBindParams(args))
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}

function wrapBindParams(x: BindParams | undefined): StatementBindParams {
  if (x && Array.isArray(x)) {
    return x
  } else if (x) {
    return [x]
  } else {
    return []
  }
}

class WrappedTx implements Tx {
  constructor(private db: Database) {}

  run(
    { sql, args }: Statement,
    successCallback?: (tx: WrappedTx, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    try {
      const prep = this.db.prepare(sql)
      const res = prep.run(...wrapBindParams(args))
      if (typeof successCallback !== 'undefined')
        successCallback(this, { rowsAffected: res.changes })
    } catch (err) {
      if (typeof errorCallback !== 'undefined') errorCallback(err)
      throw err // makes the transaction fail (needed to have consistent behavior with react-native and expo drivers which also fail if one of the statements fail)
    }
  }

  query(
    { sql, args }: Statement,
    successCallback: (tx: WrappedTx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    try {
      const stmt = this.db.prepare(sql)
      const rows = stmt.all(...wrapBindParams(args))
      successCallback(this, rows)
    } catch (err) {
      if (typeof errorCallback !== 'undefined') errorCallback(err)
      throw err // makes the transaction fail (needed to have consistent behavior with react-native and expo drivers which also fail if one of the statements fail)
    }
  }
}
