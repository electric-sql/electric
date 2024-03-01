import { BatchQueryResult, QueryResult } from '@op-engineering/op-sqlite'
import { DbName } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  constructor(public dbName: DbName, public fail?: Error) {}

  executeAsync(): Promise<QueryResult> {
    const _array = [
      {
        column1: 'text1',
        column2: 'text2',
      },
    ]
    return this.resolveIfNotFail({
      rowsAffected: 1,
      rows: {
        _array,
        length: 1,
        item: (idx: number) => _array[idx],
      },
    })
  }
  executeBatchAsync(): Promise<BatchQueryResult> {
    return this.resolveIfNotFail({ rowsAffected: 1 })
  }

  private resolveIfNotFail<T>(value: T): Promise<T> {
    if (typeof this.fail !== 'undefined') {
      return Promise.reject(this.fail)
    }
    return Promise.resolve(value)
  }
}
