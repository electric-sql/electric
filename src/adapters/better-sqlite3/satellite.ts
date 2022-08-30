import { SatelliteClient as SatelliteClientInterface } from '../../satellite/index'
import { AnyFunction, BindParams, Row } from '../../util/types'
import { Database } from './database'

export class SatelliteClient implements SatelliteClientInterface {
  db: Database

  constructor(db: Database) {
    this.db = db
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve: AnyFunction) => {
      this.db.exec(sql)

      resolve()
    })
  }

  select(sql: string, bindParams: BindParams = []): Promise<Row[]> {
    const stmt = this.db.prepare(sql)

    return new Promise((resolve: AnyFunction) => {
      resolve(stmt.all(bindParams))
    })
  }
}
