import { SatelliteDatabaseAdapter as SatelliteDatabaseAdapterInterface } from '../../satellite/index'
import { SQLitePluginSatelliteDatabaseAdapter } from '../sqlite-plugin/satellite'
import { Database } from './database'

export class SatelliteDatabaseAdapter extends SQLitePluginSatelliteDatabaseAdapter implements SatelliteDatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    super(db)

    this.db = db
  }
}
