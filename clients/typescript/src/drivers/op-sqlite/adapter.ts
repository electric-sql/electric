
import { Row, SqlValue } from '../../util/types'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { Statement } from '../../util'
import { Database } from './database'
import { RunResult } from '../../electric/adapter';


export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  #rowsAffected = 0

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _query(statement: Statement): Promise<Row[]> {
    const result = this.db.execute(
      statement.sql,
      statement.args
    )
    return result.rows?._array ?? []
  }
  async _run(statement: Statement): Promise<RunResult> {
    const result = this.db.execute(
      statement.sql,
      statement.args
    )
    return {rowsAffected : result.rowsAffected}
  }

  async execBatch(statements: Statement[]): Promise<RunResult>{
    const set: any[] = statements.map(({sql,args})=>({
      statement:sql,
      values: (args ?? []) as SqlValue[],
     }))
     
     const result = this.db.executeBatch(set)

     this.#rowsAffected = result?.rowsAffected ?? 0
     return {rowsAffected : this.#rowsAffected}

  }
  getRowsModified(): number {
    return this.#rowsAffected
  }

}
