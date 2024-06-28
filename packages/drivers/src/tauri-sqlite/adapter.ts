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

  _run(statement: Statement): Promise<RunResult> {
    return this.db.execute(statement.sql, statement.args)
  }

  _query(statement: Statement): Promise<Row[]> {
    return this.db.select(statement.sql, statement.args)
  }
}
