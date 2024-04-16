import { Database } from './database'
import { Row, SqlValue } from '../../util/types'
import { Statement } from '../../util'
import { BatchDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { capSQLiteSet } from '@capacitor-community/sqlite'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'main'

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _query(statement: Statement): Promise<Row[]> {
    const wrapInTransaction = false
    const result = await this.db.query(
      statement.sql,
      statement.args,
      wrapInTransaction
    )

    return result.values ?? []
  }

  async _run(statement: Statement): Promise<RunResult> {
    const wrapInTransaction = false

    // if no bind values are provided, use `execute` API which
    // has less overhead and native side pre-processing
    const result = await (statement.args && statement.args.length > 0
      ? this.db.run(statement.sql, statement.args, wrapInTransaction)
      : this.db.execute(statement.sql, wrapInTransaction))

    const rowsAffected = result.changes?.changes ?? 0
    return { rowsAffected: rowsAffected }
  }

  async execBatch(statements: Statement[]): Promise<RunResult> {
    const set: capSQLiteSet[] = statements.map(({ sql, args }) => ({
      statement: sql,
      values: (args ?? []) as SqlValue[],
    }))

    const wrapInTransaction = true
    const result = await this.db.executeSet(set, wrapInTransaction)

    const rowsAffected = result.changes?.changes ?? 0
    return { rowsAffected: rowsAffected }
  }
}
