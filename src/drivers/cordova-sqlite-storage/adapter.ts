import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'
import { SQLitePluginDatabaseAdapter } from '../sqlite-plugin/adapter'
import { Database } from './database'

export class DatabaseAdapter
  extends SQLitePluginDatabaseAdapter
  implements DatabaseAdapterInterface
{
  db: Database

  constructor(db: Database) {
    super(db)

    this.db = db
  }
}
