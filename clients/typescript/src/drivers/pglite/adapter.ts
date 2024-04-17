import { Database } from './database'
import { Row } from '../../util/types'
import { Statement } from '../../util'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'public'

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _run(statement: Statement): Promise<RunResult> {
    const res = await this.db.query(statement.sql, statement.args)
    return {
      rowsAffected: res.affectedRows ?? 0,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    return (await this.db.query<Row>(statement.sql, statement.args)).rows
  }
}
