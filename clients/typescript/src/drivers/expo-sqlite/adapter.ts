import { Row } from '../../util/types'
import { Statement } from '../../util'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { Database } from './database'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  #rowsModified = 0

  constructor(db: Database) {
    super()
    this.db = db
  }

  private async exec(statement: Statement): Promise<Row[]> {
    return new Promise((resolve, reject) => {
      const stmt = { sql: statement.sql, args: statement.args ?? [] }
      this.db.execRawQuery([stmt], false, (err, result) => {
        if (err) {
          reject(err.message)
        } else if (result) {
          const [res] = result
          if ('error' in res) {
            reject(res.error.message)
          } else {
            this.#rowsModified = res.rowsAffected
            resolve(res.rows)
          }
        } else {
          resolve([])
        }
      })
    })
  }

  private getRowsModified() {
    return this.#rowsModified
  }

  async _run(statement: Statement): Promise<RunResult> {
    await this.exec(statement)
    return {
      rowsAffected: this.getRowsModified(),
    }
  }

  _query(statement: Statement): Promise<Row[]> {
    return this.exec(statement)
  }
}
