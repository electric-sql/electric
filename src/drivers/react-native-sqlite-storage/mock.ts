import { AnyFunction, DbName } from '../../util/types'
import { MockSQLitePlugin } from '../sqlite-plugin/mock'
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

export class MockDatabase extends MockSQLitePlugin implements Database {
  dbName: DbName

  constructor(dbName: DbName) {
    super(dbName)

    this.dbName = dbName
  }

  attach(dbName: DbName, dbAlias: DbName): Promise<void>
  attach(
    dbName: DbName,
    dbAlias: DbName,
    success?: AnyFunction,
    error?: AnyFunction
  ): void
  attach(
    _dbName: DbName,
    _dbAlias: DbName,
    success?: AnyFunction,
    error?: AnyFunction
  ): void | Promise<void> {
    if (success === undefined && error === undefined) {
      return Promise.resolve()
    } else if (typeof success === 'function') {
      success('mocked!')
    }
  }

  detach(dbName: DbName): Promise<void>
  detach(dbName: DbName, success?: AnyFunction, error?: AnyFunction): void
  detach(
    _dbAlias: DbName,
    success?: (...args: any[]) => any,
    error?: (...args: any[]) => any
  ): void | Promise<void> {
    if (success === undefined && error === undefined) {
      return Promise.resolve()
    } else if (typeof success === 'function') {
      success('mocked!')
    }
  }

  echoTest(success?: AnyFunction, _error?: AnyFunction): void {
    if (success) {
      success('mocked!')
    }
  }
}
