import {
  TransactionErrorCallback,
  TransactionCallback,
  ResultSet,
  StatementCallback,
  StatementErrorCallback,
} from 'react-native-sqlite-storage'
import { AnyFunction, DbName, Row } from '../../util/types'
import { Database, Transaction } from './database'

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
  constructor(public dbName: DbName) {}

  transaction(txFn: (tx: Transaction) => void): Promise<Transaction>
  transaction(
    txFn: (tx: Transaction) => void,
    error?: TransactionErrorCallback,
    success?: TransactionCallback
  ): void
  transaction(
    txFn: (tx: Transaction) => void,
    error?: TransactionErrorCallback,
    success?: TransactionCallback
  ): void | Promise<Transaction> {
    const tx = new MockTransaction(false)
    txFn(tx)

    if (error || success) {
      success && success(tx)
    } else {
      return Promise.resolve(tx)
    }
  }

  readTransaction(txFn: (tx: Transaction) => void): Promise<Transaction>
  readTransaction(
    txFn: (tx: Transaction) => void,
    error?: TransactionErrorCallback,
    success?: TransactionCallback
  ): void
  readTransaction(
    txFn: (tx: Transaction) => void,
    _error?: TransactionErrorCallback,
    success?: TransactionCallback
  ): void | Promise<Transaction> {
    const tx = new MockTransaction(false)
    txFn(tx)
    success && success(tx)
  }

  executeSql(statement: string, params?: any[]): Promise<[ResultSet]>
  executeSql(
    statement: string,
    params?: any[],
    success?: StatementCallback,
    error?: StatementErrorCallback
  ): void
  executeSql(
    statement: string,
    params?: any[],
    success?: StatementCallback,
    error?: StatementErrorCallback
  ): void | Promise<[ResultSet]> {
    this.transaction((tx) => tx.executeSql(statement, params, success, error))
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

class MockTransaction implements Transaction {
  constructor(public readonly: boolean) {}

  executeSql(
    sqlStatement: string,
    args?: any[]
  ): Promise<[Transaction, ResultSet]>
  executeSql(
    sqlStatement: string,
    args?: any[],
    callback?: StatementCallback,
    errorCallback?: StatementErrorCallback
  ): void
  executeSql(
    _sqlStatement: string,
    _args?: any[],
    callback?: StatementCallback,
    errorCallback?: StatementErrorCallback
  ): void | Promise<[Transaction, ResultSet]> {
    const results = mockResults([{ i: 0 }])

    if (callback) {
      callback(this, results)
    } else if (!callback && !errorCallback) {
      return Promise.resolve([this, results])
    }
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
