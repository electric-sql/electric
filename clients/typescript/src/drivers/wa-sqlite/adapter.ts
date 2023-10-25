import { Database } from './database'
import { Row } from '../../util/types'
import { Statement } from '../../util'
import { DatabaseAdapter as GenericDatabaseAdapter } from '../generic'

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
