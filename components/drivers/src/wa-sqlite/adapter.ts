import { Database } from './database.js'
import { Row, Statement } from '../util/types.js'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic/adapter.js'
import { RunResult } from '../adapter.js'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'main'

  constructor(db: Database) {
    super()
    this.db = db
  }

  private exec(statement: Statement): Promise<Row[]> {
    return this.db.exec(statement)
  }

  private getRowsModified() {
    return this.db.getRowsModified()
  }

  async _run(statement: Statement): Promise<RunResult> {
    await this.exec(statement)
    return {
      rowsAffected: this.getRowsModified(),
    }
  }

  _query(statement: Statement): Promise<Row[]> {
    return this.exec(statement)
  }
}
