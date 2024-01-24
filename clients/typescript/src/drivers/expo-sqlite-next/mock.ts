import { Database } from './database'
import {
  SQLiteBindParams,
  SQLiteVariadicBindParams,
  SQLiteRunResult,
} from 'expo-sqlite/next'

export class MockDatabase implements Database {
  constructor(public databaseName: string, public fail?: Error) {}
  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return task()
  }

  getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]>
  getAllAsync<T>(
    source: string,
    ...params: SQLiteVariadicBindParams
  ): Promise<T[]>
  getAllAsync<T>(_source: string, _params?: unknown): Promise<T[]> {
    return this.resolveIfNotFail([{ i: 0 } as T])
  }

  runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult>
  runAsync(
    source: string,
    ...params: SQLiteVariadicBindParams
  ): Promise<SQLiteRunResult>
  runAsync(_source: string, _params?: unknown): Promise<SQLiteRunResult> {
    return this.resolveIfNotFail({
      lastInsertRowId: 0,
      changes: 0,
    })
  }

  private resolveIfNotFail<T>(value: T): Promise<T> {
    if (typeof this.fail !== 'undefined') return Promise.reject(this.fail)
    else return Promise.resolve(value)
  }
}
