import { Row, SqlValue, Statement } from '../util/types.js'
import { RunResult } from '../adapter.js'
import { Database } from './database.js'
import { SerialDatabaseAdapter } from '../generic/adapter.js'

export class DatabaseAdapter extends SerialDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'main'
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
