import { Row } from '../../util/types'
import { Statement } from '../../util'
import { DatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { Database } from './database'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  #rowsModified = 0

  constructor(db: Database) {
    super()
    this.db = db
  }

  async exec(statement: Statement): Promise<Row[]> {
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

  getRowsModified() {
    return this.#rowsModified
  }
}
