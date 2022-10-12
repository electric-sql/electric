import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'

import { parseTableNames } from '../../util/parser'
import { QualifiedTablename } from '../../util/tablename'
import { Row, Statement } from '../../util/types'

import { Database } from './database'
import { resultToRows } from './result'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }
  runTransaction(..._statements: Statement[]): Promise<void> {
    throw Error("not implemented")
  }

  async run(statement: Statement): Promise<void> {
    await this.db.run(statement.sql, statement.args)    
  }

  async query(statement: Statement): Promise<Row[]> {
    const result = await this.db.exec(statement.sql, statement.args)

    return resultToRows(result)
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}
