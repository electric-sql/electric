import { SatelliteDatabaseAdapter as SatelliteDatabaseAdapterInterface } from '../../satellite/index'
import { BindParams, Row } from '../../util/types'
import { Database } from './database'
import { resultToRows } from './query'

export class SatelliteDatabaseAdapter implements SatelliteDatabaseAdapterInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  async exec(sql: string): Promise<void> {
    await this.db.run(sql)
  }

  async query(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const result = await this.db.exec(sql, bindParams)

    return resultToRows(result)
  }
}
