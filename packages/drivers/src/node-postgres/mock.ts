import { Database } from './database.js'
import { QueryConfig, QueryResult, QueryResultRow } from 'pg'
import { DbName } from '../util/types.js'

export class MockDatabase implements Database {
  name: DbName
  fail: Error | undefined

  constructor(
    public host: string,
    public port: number,
    public database?: string,
    fail?: Error
  ) {
    this.name = `${host}:${port}/${database ?? ''}`
    this.fail = fail
  }

  async query<R extends QueryResultRow = any, I extends any[] = any[]>(
    _queryConfig: QueryConfig<I>
  ): Promise<Pick<QueryResult<R>, 'rows' | 'rowCount'>> {
    if (typeof this.fail !== 'undefined') throw this.fail

    return {
      rows: [{ val: 1 } as unknown as R, { val: 2 } as unknown as R],
      rowCount: 0,
    }
  }

  async stop(): Promise<void> {
    return
  }
}
