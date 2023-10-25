import type { DbName } from '../../util'
import { SQLiteDatabase } from 'expo-sqlite'
import { Database as GenericDatabase } from '../generic'
import { Statement } from '../../util'
import { Results, rowsFromResults } from '../util/results'
import { Row } from '../../util/types'

export type OriginalDatabase = Pick<SQLiteDatabase, 'execRawQuery' | '_name'>

export class Database implements GenericDatabase {
  name: DbName
  private rowsModified: number
  constructor(private db: OriginalDatabase) {
    this.name = db._name
    this.rowsModified = 0
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
            this.rowsModified = res.rowsAffected
            resolve(rowsFromResults(res as unknown as Results))
          }
        } else {
          resolve([])
        }
      })
    })
  }

  getRowsModified() {
    return this.rowsModified
  }
}
