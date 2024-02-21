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

  _run(statement: Statement): Promise<RunResult> {
    return this.db.execute(statement.sql, statement.args)
  }

  _query(statement: Statement): Promise<Row[]> {
    return this.db.select(statement.sql, statement.args)
  }
}
