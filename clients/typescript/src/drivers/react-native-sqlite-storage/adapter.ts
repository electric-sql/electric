import { Row } from '../../util/types'
import { Statement } from '../../util'
import { RunResult } from '../../electric/adapter'
import { Database } from './database'
import { SerialDatabaseAdapter } from '../generic'

export class DatabaseAdapter extends SerialDatabaseAdapter {
  readonly db: Database
  private promisesEnabled: boolean
  constructor(db: Database, promisesEnabled: boolean) {
    super()
    this.db = db
    this.promisesEnabled = promisesEnabled
  }

  async _run(statement: Statement): Promise<RunResult> {
    const { sql: source, args: params } = statement
    if (!this.promisesEnabled) {
      return new Promise((resolve, reject) =>
        this.db.executeSql(
          source,
          params,
          (_, result) => resolve({ rowsAffected: result.rowsAffected }),
          (_, error) => reject(error)
        )
      )
    }

    const [result] = await this.db.executeSql(source, params)
    return {
      rowsAffected: result.rowsAffected,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    const { sql: source, args: params } = statement
    if (!this.promisesEnabled) {
      return new Promise((resolve, reject) =>
        this.db.executeSql(
          source,
          params,
          (_, result) => resolve(result.rows.raw()),
          (_, error) => reject(error)
        )
      )
    }

    const [result] = await this.db.executeSql(source, params)
    return result.rows.raw()
  }
}
