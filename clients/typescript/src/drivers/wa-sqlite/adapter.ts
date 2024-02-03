import { Database } from './database'
import { Row } from '../../util/types'
import { Statement } from '../../util'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database

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
