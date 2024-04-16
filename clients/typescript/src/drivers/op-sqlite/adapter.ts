import { Row, SqlValue } from '../../util/types'
import { BatchDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { Statement } from '../../util'
import { Database } from './database'
import { RunResult } from '../../electric/adapter'
import { SQLBatchTuple } from '@op-engineering/op-sqlite'

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'main'

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _query(statement: Statement): Promise<Row[]> {
    const result = await this.db.executeAsync(statement.sql, statement.args)

    // the results returned are HostObjects and not regular JS objects and
    // do not work in the same way - we shallow clone them to a regular JS
    // object as the code makes use of Object APIs like Object.entries to
    // work properly. See:
    // https://ospfranco.notion.site/Gotchas-bedf4f3e9dc1444480fc687d8917751a
    // https://github.com/OP-Engineering/op-sqlite/issues/65
    return result.rows!._array.map(shallowClone)
  }
  async _run(statement: Statement): Promise<RunResult> {
    const result = await this.db.executeAsync(statement.sql, statement.args)
    return { rowsAffected: result.rowsAffected! }
  }

  async execBatch(statements: Statement[]): Promise<RunResult> {
    const set: SQLBatchTuple[] = statements.map(({ sql, args }) => [
      sql,
      (args ?? []) as SqlValue[],
    ])

    const result = await this.db.executeBatchAsync(set)

    return { rowsAffected: result.rowsAffected! }
  }
}

function shallowClone(obj: Record<string, any>) {
  const clonedObj: Record<string, any> = {}
  for (const key in obj) {
    clonedObj[key] = obj[key]
  }
  return clonedObj
}
