import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { BindParams, Row } from '../../util/types'

import { Database } from './database'
import { resultToRows } from './result'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  async run(sql: string): Promise<void> {
    await this.db.run(sql)
  }

  async query(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const result = await this.db.exec(sql, bindParams)

    return resultToRows(result)
  }

  tableNames(sql: string): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}
