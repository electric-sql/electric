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
