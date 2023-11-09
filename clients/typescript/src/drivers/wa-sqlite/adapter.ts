import { Database } from './database.js'
import { Row } from '../../util/types.js'
import { Statement } from '../../util/index.js'
import { DatabaseAdapter as GenericDatabaseAdapter } from '../generic/index.js'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database

  constructor(db: Database) {
    super()
    this.db = db
  }

  async exec(statement: Statement): Promise<Row[]> {
    return this.db.exec(statement)
  }

  getRowsModified() {
    return this.db.getRowsModified()
  }
}
