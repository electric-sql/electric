import { Database } from './database'
import {
  SQLiteBindParams,
  SQLiteVariadicBindParams,
  SQLiteRunResult,
} from 'expo-sqlite/next'

export class MockDatabase implements Database {
  constructor(public databaseName: string) {}
  getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]>
  getAllAsync<T>(
    source: string,
    ...params: SQLiteVariadicBindParams
  ): Promise<T[]>
  getAllAsync<T>(_source: string, _params?: unknown): Promise<T[]> {
    return Promise.resolve([{ i: 0 } as T])
  }

  runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult>
  runAsync(
    source: string,
    ...params: SQLiteVariadicBindParams
  ): Promise<SQLiteRunResult>
  runAsync(_source: string, _params?: unknown): Promise<SQLiteRunResult> {
    return Promise.resolve({
      lastInsertRowId: 0,
      changes: 0,
    })
  }
}
