import { AnyFunction, DbName } from '../../util/types'
import { Database, Transaction } from './index'

const promisablePatchedMethods = [
  'attach',
  'detach',
  'echoTest'
]
const isPromisablePatchedMethod = (key: string | symbol) => {
  return typeof key === 'string' && promisablePatchedMethods.includes(key)
}

// This adapts the `mockDb` to function like the SQLPlugin does
// after `SQLPluginFactory.enablePromise(true)` has been called.
export const enablePromiseRuntime = (mockDb: MockDatabase): MockDatabase => {
  return new Proxy(mockDb, {
    get(target, key, receiver) {
      let value = Reflect.get(target, key, receiver)

      if (isPromisablePatchedMethod(key)) {
        return (...args: any): any => {
          return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
            let success = function(...args: any[]): any {
              return resolve(...args)
            }

            let error = function(err: any): any {
              reject(err)
              return false
            }

            Reflect.apply(value, target, [...args, success, error])
          })
        }
      }

      return value
    }
  })
}

export class MockDatabase implements Database {
  dbName: DbName

  databaseFeatures: {
    isSQLitePluginDatabase: true
  }
  openDBs: {
    [key: DbName]: 'INIT' | 'OPEN'
  }

  constructor(dbName: DbName) {
    this.dbName = dbName

    this.databaseFeatures = {isSQLitePluginDatabase: true}
    this.openDBs = {}
    this.openDBs[dbName] = 'OPEN'
  }

  addTransaction(tx: Transaction): void {
    if (!!tx.success) {
      tx.success('mocked!')
    }
  }

  attach(_dbName: DbName, _dbAlias: DbName, success?: AnyFunction, _error?: AnyFunction): void {
    if (!!success) {
      success('mocked!')
    }
  }

  detach(_dbAlias: DbName, success?: (...args: any[]) => any, _error?: (...args: any[]) => any): void {
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

export class MockTransaction implements Transaction {
  readOnly: boolean

  constructor(readOnly: boolean = false) {
    this.readOnly = readOnly
  }

  success(..._args: any[]): void {}
}
