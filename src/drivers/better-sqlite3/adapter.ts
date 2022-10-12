import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { Statement as DbStatement, Row, Statement } from '../../util/types'

import { Database } from './database'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  async runTransaction(...statements: DbStatement[]): Promise<void> {
    const txn = this.db.transaction((stmts: DbStatement[]) => {
      for (const stmt of stmts) {
        this.run(stmt)
      }
    })
    return txn(statements)
  }

  // Promise interface, but impl not actually async
  async run({ sql, args }: DbStatement): Promise<void> {
    this.db.prepare(sql).run(args ? args : [])
  }

  async query({ sql, args }: DbStatement): Promise<Row[]> {
    const stmt = this.db.prepare(sql)
    return stmt.all(args ? args : [])
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {    
    return parseTableNames(sql)
  }
}
