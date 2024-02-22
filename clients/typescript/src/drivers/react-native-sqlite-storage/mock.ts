import {
  ResultSet,
  Transaction,
  StatementCallback,
  StatementErrorCallback,
  SQLError,
} from 'react-native-sqlite-storage'
import { AnyFunction, DbName, Row } from '../../util/types'
import { Database } from './database'

// Key is the method name, value is whether the
// callbacks need to be reversed.
const promisablePatchedMethods: { [key: string]: boolean } = {
  attach: false,
  detach: false,
  echoTest: false,
  readTransaction: true,
  sqlBatch: false,
  transaction: true,
}

// This adapts the `mockDb` to behave like the SQLitePlugin does
// after `SQLitePluginFactory.enablePromise(true)` has been called.
export const enablePromiseRuntime = (mockDb: MockDatabase): MockDatabase => {
  return new Proxy(mockDb, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)

      if (typeof key === 'string' && key in promisablePatchedMethods) {
        const shouldReverseCallbacks = promisablePatchedMethods[key]

        return (...args: any): any => {
          return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
            const success = function (...args: any[]): any {
              return resolve(...args)
            }

            const error = function (err: any): any {
              reject(err)
              return false
            }

            const argsList = shouldReverseCallbacks
              ? [...args, error, success]
              : [...args, success, error]

            Reflect.apply(value, target, argsList)
          })
        }
      }

      return value
    },
  })
}

export class MockDatabase implements Database {
  constructor(public dbname: DbName, public fail?: SQLError) {}

  executeSql(statement: string, params?: any[]): Promise<[ResultSet]>
  executeSql(
    statement: string,
    params?: any[],
    success?: StatementCallback,
    error?: StatementErrorCallback
  ): void
  executeSql(
    _: string,
    __?: any[],
    success?: StatementCallback,
    error?: StatementErrorCallback
  ): void | Promise<[ResultSet]> {
    const mockResult = mockResults([{ i: 0 }])
    if (success || error) {
      Promise.resolve().then(() => {
        if (this.fail) return error?.(new MockTransaction(), this.fail)
        success?.(new MockTransaction(), mockResult)
      })
      return
    }

    return this.fail ? Promise.reject(this.fail) : Promise.resolve([mockResult])
  }
}

function mockResults(rows: Row[]): ResultSet {
  return {
    insertId: 1,
    rows: {
      item: (i: number) => rows[i],
      length: rows.length,
      raw: () => rows,
    },
    rowsAffected: 0,
  }
}

class MockTransaction implements Transaction {
  executeSql(
    sqlStatement: string,
    params?: any[] | undefined
  ): Promise<[Transaction, ResultSet]>
  executeSql(
    sqlStatement: string,
    params?: any[] | undefined,
    callback?: StatementCallback | undefined,
    errorCallback?: StatementErrorCallback | undefined
  ): void
  executeSql(): void | Promise<[Transaction, ResultSet]> {}
}
