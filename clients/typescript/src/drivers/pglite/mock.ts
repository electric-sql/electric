import { Database } from './database'
import type { PGliteOptions, QueryOptions, Results } from '@electric-sql/pglite'

export class MockDatabase implements Database {
  dataDir?: string
  fail: Error | undefined

  constructor(dataDir?: string, _options?: PGliteOptions) {
    this.dataDir = dataDir
  }

  async query<T>(
    _query: string,
    _params?: any[],
    _options?: QueryOptions
  ): Promise<Results<T>> {
    if (typeof this.fail !== 'undefined') throw this.fail

    return {
      rows: [{ val: 1 } as T, { val: 2 } as T],
      affectedRows: 0,
      fields: [
        {
          name: 'val',
          dataTypeID: 0,
        },
      ],
    }
  }
}
