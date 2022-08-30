import { SatelliteClient as SatelliteClientInterface } from '../../satellite/index'
import { SQLitePluginSatelliteClient } from '../sqlite-plugin/satellite'
import { Database } from './database'

export class SatelliteClient extends SQLitePluginSatelliteClient implements SatelliteClientInterface {
  db: Database

  constructor(db: Database, promisesEnabled?: boolean) {
    super(db)

    this.db = db
    this.promisesEnabled = promisesEnabled !== undefined
      ? promisesEnabled
      : db.echoTest() instanceof Promise
  }
}
