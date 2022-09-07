import { QueryAdapter as QueryAdapterInterface } from '../../query-adapters/index'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { BindParams, DbNamespace, Row } from '../../util/types'

import { Database, Statement } from './database'

type Query = string | Statement

export class QueryAdapter implements QueryAdapterInterface {
  db: Database
  defaultNamespace: DbNamespace

  constructor(db: Database, defaultNamespace: DbNamespace) {
    this.db = db
    this.defaultNamespace = defaultNamespace
  }

  async perform(query: Query, bindParams: BindParams): Promise<Row[]> {
    const stmt: Statement = typeof query === 'string'
      ? this.db.prepare(query)
      : query

    return stmt.all(bindParams)
  }

  tableNames(query: Query): QualifiedTablename[] {
    const sql: string = typeof query === 'string'
      ? query
      : query.source

    return parseTableNames(sql, this.defaultNamespace)
  }
}
