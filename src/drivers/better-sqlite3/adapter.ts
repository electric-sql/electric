import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { BindParams, Row } from '../../util/types'

import { Database, Statement } from './database'

type Query = string | Statement

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  async run(sql: string): Promise<void> {
    await this.db.exec(sql)
  }

  async query(query: Query, bindParams: BindParams = []): Promise<Row[]> {
    const stmt: Statement = typeof query === 'string'
      ? this.db.prepare(query)
      : query

    return stmt.all(bindParams)
  }

  tableNames(query: Query): QualifiedTablename[] {
    const sql: string = typeof query === 'string'
      ? query
      : query.source

    return parseTableNames(sql)
  }
}
