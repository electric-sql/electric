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
      let value = Reflect.get(target, key, receiver)

      if (typeof key === 'string' && key in promisablePatchedMethods) {
        const shouldReverseCallbacks = promisablePatchedMethods[key]

        return (...args: any): any => {
          return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
            let success = function (...args: any[]): any {
              return resolve(...args)
            }

            let error = function (err: any): any {
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

  attach(
    _dbName: DbName,
    _dbAlias: DbName,
    success?: AnyFunction,
    _error?: AnyFunction
  ): void {
    if (!!success) {
      success('mocked!')
    }
  }

  detach(
    _dbAlias: DbName,
    success?: (...args: any[]) => any,
    _error?: (...args: any[]) => any
  ): void {
    if (!!success) {
      success('mocked!')
    }
  }

  echoTest(success?: AnyFunction, _error?: AnyFunction): void {
    if (!!success) {
      success('mocked!')
    }
  }
}
