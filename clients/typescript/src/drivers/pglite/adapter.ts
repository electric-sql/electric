import { Database } from './database'
import { Row } from '../../util/types'
import { Statement } from '../../util'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { RunResult } from '../../electric/adapter'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _run(statement: Statement): Promise<RunResult> {
    console.log('_run:', statement.sql)
    const res = await this.db.query(statement.sql, statement.args)
    console.log('res:', res)
    return {
      rowsAffected: res.affectedRows ?? 0,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    console.log('_query:', statement.sql)
    const ret = (await this.db.query<Row>(statement.sql, statement.args)).rows
    console.log('ret:', ret)
    return ret
  }
}
