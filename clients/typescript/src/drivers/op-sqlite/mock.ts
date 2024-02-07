import { BatchQueryResult, QueryResult } from '@op-engineering/op-sqlite'
import { DbName } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  constructor(public dbname: DbName, public fail?: Error) {}

  executeAsync(): Promise<QueryResult> {
    return Promise.resolve({
      rowsAffected: 1,
      rows: {
        _array: [
          {
            column1: 'text1',
            column2: 'text2',
          },
        ],
        length: 1,
        item: (idx: number) => idx,
      },
    })
  }
  executeBatchAsync(): Promise<BatchQueryResult> {
    return Promise.resolve({ rowsAffected: 1 })
  }
}
