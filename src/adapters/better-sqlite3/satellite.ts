import { SatelliteDatabaseAdapter as SatelliteDatabaseAdapterInterface } from '../../satellite/index'
import { BindParams, Row } from '../../util/types'
import { Database } from './database'

export class SatelliteDatabaseAdapter implements SatelliteDatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  exec(sql: string): Promise<void> {
    this.db.exec(sql)

    return Promise.resolve()
  }

  query(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const stmt = this.db.prepare(sql)

    return Promise.resolve(stmt.all(bindParams))
  }
}
