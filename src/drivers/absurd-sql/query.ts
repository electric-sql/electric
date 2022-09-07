import { QueryAdapter as QueryAdapterInterface } from '../../query-adapters/index'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { BindParams, DbNamespace, Row, SqlValue } from '../../util/types'

import { Database, QueryExecResult } from './database'

export const resultToRows = (result: QueryExecResult): Row[] => {
  const rows: Row[] = []
  const cols = result.columns

  result.values.map((values: SqlValue[]) => {
    const row: Row = {}

    values.map((val: SqlValue, i: number) => {
      const col = cols[i]

      row[col] = val
    })

    rows.push(row)
  })

  return rows
}

export class QueryAdapter implements QueryAdapterInterface {
  db: Database
  defaultNamespace: DbNamespace

  constructor(db: Database, defaultNamespace: DbNamespace) {
    this.db = db
    this.defaultNamespace = defaultNamespace
  }

  // XXX accept prepared statements?
  async perform(query: string, bindParams: BindParams): Promise<Row[]> {
    const result = await this.db.exec(query, bindParams)

    return resultToRows(result)
  }

  tableNames(query: string): QualifiedTablename[] {
    return parseTableNames(query, this.defaultNamespace)
  }
}
