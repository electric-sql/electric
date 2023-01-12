import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'

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

  async runInTransaction(...statements: DbStatement[]): Promise<void> {
    const txn = this.db.transaction((stmts: DbStatement[]) => {
      for (const stmt of stmts) {
        this.run(stmt)
      }
    })
    return txn(statements)
  }

  // Promise interface, but impl not actually async
  async run({ sql, args }: DbStatement): Promise<void> {
    const prep = this.db.prepare(sql)
    prep.run(...wrapBindParams(args))
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
