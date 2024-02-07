import { Row, SqlValue } from '../../util/types'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { Statement } from '../../util'
import { Database } from './database'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _query(statement: Statement): Promise<Row[]> {
    const result = await this.db.executeAsync(statement.sql, statement.args)
    return result.rows?._array ?? []
  }
  async _run(statement: Statement): Promise<RunResult> {
    const result = await this.db.executeAsync(statement.sql, statement.args)
    return { rowsAffected: result.rowsAffected }
  }

  async execBatch(statements: Statement[]): Promise<RunResult> {
    const set: any[] = statements.map(({ sql, args }) => ({
      statement: sql,
      values: (args ?? []) as SqlValue[],
    }))

    const result = await this.db.executeBatchAsync(set)

    return { rowsAffected: result?.rowsAffected ?? 0 }
  }
}
