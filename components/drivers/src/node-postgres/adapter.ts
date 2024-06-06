import pg from 'pg'
import { Database } from './database.js'
import { Row, Statement } from '../util/types.js'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic/adapter.js'
import { RunResult } from '../adapter.js'
import { parseDate } from '../util/parser.js'

const originalGetTypeParser = pg.types.getTypeParser

export type QueryResult = {
  rows: Row[]
  rowsModified: number
}

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'public'

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _run(statement: Statement): Promise<RunResult> {
    const { rowsModified } = await this.exec(statement)
    return {
      rowsAffected: rowsModified,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    const { rows } = await this.exec(statement)
    return rows
  }

  async exec(statement: Statement): Promise<QueryResult> {
    const { rows, rowCount } = await this.db.query<Row>({
      text: statement.sql,
      values: statement.args,
      types: {
        getTypeParser: ((oid: number) => {
          if (
            oid === pg.types.builtins.TIMESTAMP ||
            oid === pg.types.builtins.TIMESTAMPTZ ||
            oid === pg.types.builtins.DATE
          ) {
            // Parse timestamps and date values ourselves
            // because the pg parser parses them differently from what we expect
            // and we want the results to be consistent with the other drivers
            return parseDate
          }
          return originalGetTypeParser(oid)
        }) as typeof pg.types.getTypeParser,
      },
    })
    return {
      rows,
      rowsModified: rowCount ?? 0,
    }
  }
}
