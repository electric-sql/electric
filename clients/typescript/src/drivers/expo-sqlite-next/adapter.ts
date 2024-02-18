import { Row, SqlValue } from '../../util/types'
import { Statement } from '../../util'
import { RunResult } from '../../electric/adapter'
import { Database } from './database'
import { SerialDatabaseAdapter } from '../generic'

export class DatabaseAdapter extends SerialDatabaseAdapter {
  readonly db: Database
  constructor(db: Database) {
    super()
    this.db = db
  }

  async _run(statement: Statement): Promise<RunResult> {
    const { sql: source, args: params = [] } = statement
    const result = await this.db.runAsync(
      source,
      params as Omit<SqlValue, 'bigint'>
    )
    return {
      rowsAffected: result.changes,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    const { sql: source, args: params = [] } = statement
    return await this.db.getAllAsync(source, params as Omit<SqlValue, 'bigint'>)
  }
}
