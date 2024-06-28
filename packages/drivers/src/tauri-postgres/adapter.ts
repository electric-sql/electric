import { Database } from './database.js'
import { Row, Statement } from '../util/types.js'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic/adapter.js'
import { RunResult } from '../adapter.js'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'public'

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _run(statement: Statement): Promise<RunResult> {
    const { rowsModified } = await this.db.exec(statement)
    return {
      rowsAffected: rowsModified,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    const { rows } = await this.db.exec(statement)
    return rows
  }
}
