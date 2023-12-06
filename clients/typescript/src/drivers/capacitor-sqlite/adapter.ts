import { Database } from './database'
import { Row, SqlValue } from '../../util/types'
import { Statement } from '../../util'
import { BatchDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { capSQLiteSet } from '@capacitor-community/sqlite'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  #rowsAffected = 0

  constructor(db: Database) {
    super()
    this.db = db
  }

  async exec(statement: Statement): Promise<Row[]> {
    const wrapInTransaction = false
    const result = await this.db.run(
      statement.sql,
      statement.args,
      wrapInTransaction
    )

    this.#rowsAffected = result.changes?.changes ?? 0

    return result.changes?.values ? result.changes.values : []
  }

  async execBatch(statements: Statement[]): Promise<RunResult> {
    const set: capSQLiteSet[] = statements.map(({ sql, args }) => ({
      statement: sql,
      values: (args ?? []) as SqlValue[],
    }))

    const wrapInTransaction = true
    const result = await this.db.executeSet(set, wrapInTransaction)

    this.#rowsAffected = result.changes?.changes ?? 0

    return { rowsAffected: this.#rowsAffected }
  }

  getRowsModified() {
    return this.#rowsAffected
  }
}
