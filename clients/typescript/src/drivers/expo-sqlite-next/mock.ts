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
  getAllAsync(_source: unknown, _params?: unknown): Promise<any[]> {
    return Promise.resolve([{ i: 0 }])
  }

  runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult>
  runAsync(
    source: string,
    ...params: SQLiteVariadicBindParams
  ): Promise<SQLiteRunResult>
  runAsync(_source: unknown, _params?: unknown): Promise<SQLiteRunResult> {
    return Promise.resolve({
      lastInsertRowId: 0,
      changes: 0,
    })
  }
}
