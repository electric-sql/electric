import type {
  Transaction,
  SQLiteDatabase as OriginalDatabase,
  TransactionCallback,
  TransactionErrorCallback,
  ResultSet,
  StatementCallback,
  StatementErrorCallback,
} from 'react-native-sqlite-storage'

import { ElectricNamespace } from '../../electric/index'
import { ProxyWrapper } from '../../proxy'
import { AnyFunction, DbName, VoidOrPromise } from '../../util/types'

export type { Transaction, StatementCallback }

import { ensurePromise } from '../generic/promise'

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.

// FIXME: pick `readTransaction`, `detach`, and `dbName` when the PR to the upstream types is merged
//        `dbName` is missing
//        `readTransaction` has incorrect returned promise type
//        `detach` is misspelled as `dettach`
export interface Database
  extends Pick<OriginalDatabase, 'transaction' | 'attach' | 'executeSql'> {
  dbName: DbName

  readTransaction(scope: (tx: Transaction) => void): Promise<Transaction>
  readTransaction(
    scope: (tx: Transaction) => void,
    error?: TransactionErrorCallback,
    success?: TransactionCallback
  ): void

  detach(dbName: DbName): Promise<void>
  detach(dbName: DbName, success?: AnyFunction, error?: AnyFunction): void
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase
  implements
    ProxyWrapper,
    Pick<Database, 'attach' | 'detach' | 'transaction' | 'executeSql'>
{
  // Private properties are not exposed via the proxy.
  _db: Database
  _promisesEnabled: boolean
  electric: ElectricNamespace

  constructor(
    db: Database,
    namespace: ElectricNamespace,
    promisesEnabled: boolean
  ) {
    this._db = db
    this._promisesEnabled = promisesEnabled
    this.electric = namespace
  }

  _setOriginal(db: Database): void {
    this._db = db
  }
  _getOriginal(): Database {
    return this._db
  }

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
    const wrappedSuccess = (tx: Transaction): Transaction => {
      this.electric.notifier.potentiallyChanged()
      if (success !== undefined) success(tx)
      return tx
    }

    if (this._promisesEnabled) {
      return ensurePromise(this._db.transaction(txFn)).then(wrappedSuccess)
    }

    return this._db.transaction(txFn, error, wrappedSuccess)
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
    if (this._promisesEnabled) {
      return ensurePromise(
        this._db.executeSql(statement, params).then((results) => {
          this.electric.notifier.potentiallyChanged()
          return results
        })
      )
    } else {
      return this._db.executeSql(
        statement,
        params,
        (tx, results) => {
          this.electric.potentiallyChanged()
          if (success) success(tx, results)
        },
        error
      )
    }
  }

  // The React Native plugin also supports attaching multiple databases
  // and running SQL statements against them both, so we also hook
  // into `attach` and `detach` to keep a running tally of all
  // the names of the attached databases.
  attach(dbName: DbName, dbAlias: DbName): Promise<void>
  attach(
    dbName: DbName,
    dbAlias: DbName,
    success?: AnyFunction,
    error?: AnyFunction
  ): void
  attach(
    dbName: DbName,
    dbAlias: DbName,
    success?: AnyFunction,
    error?: AnyFunction
  ): void | Promise<void> {
    const notifier = this.electric.notifier
    const promisesEnabled = this._promisesEnabled
    const originalSuccessFn = success

    const successFn = (...args: any[]): any => {
      notifier.attach(dbName, dbAlias)

      if (!!originalSuccessFn && !promisesEnabled) {
        return originalSuccessFn(...args)
      }
    }

    if (promisesEnabled) {
      const retval = ensurePromise(this._db.attach(dbName, dbAlias))

      return retval.then(successFn)
    }

    return this._db.attach(dbName, dbAlias, successFn, error)
  }

  detach(dbName: DbName): Promise<void>
  detach(dbName: DbName, success?: AnyFunction, error?: AnyFunction): void
  detach(
    dbAlias: string,
    success?: AnyFunction,
    error?: AnyFunction
  ): VoidOrPromise {
    const notifier = this.electric.notifier
    const promisesEnabled = this._promisesEnabled
    const originalSuccessFn = success

    const successFn = (...args: any[]): any => {
      notifier.detach(dbAlias)

      if (originalSuccessFn) {
        return originalSuccessFn(...args)
      }
    }

    if (promisesEnabled) {
      const retval = ensurePromise(this._db.detach(dbAlias))

      return retval.then(successFn)
    }

    return this._db.detach(dbAlias, successFn, error)
  }
}

export type ElectrifiedDatabase<T extends Database = Database> = T &
  ElectricDatabase
