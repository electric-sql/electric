import { Notifier } from '../../notifiers/index'
import { EmitNotifier } from '../../notifiers/event'

import { ProxyWrapper, proxyOriginal } from '../../proxy/index'

import { AnyFunction, DbName, VoidOrPromise } from '../../util/types'

const ensurePromise = (candidate: any): Promise<any> => {
  if (candidate instanceof Promise) {
    return candidate
  }

  throw `
    Expecting promises to be enabled.

    Electric SQL does not support disabling promises
    after electrifying your database client.
  `
}

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export interface Database {
  databaseFeatures: {
    isSQLitePluginDatabase: true
  }
  dbName: DbName
  openDBs: {
    [key: DbName]: 'INIT' | 'OPEN'
  }

  addTransaction(tx: Transaction): void

  attach(dbName: DbName, dbAlias: DbName, success?: AnyFunction, error?: AnyFunction): VoidOrPromise
  detach(dbAlias: DbName, success?: AnyFunction, error?: AnyFunction): VoidOrPromise

  echoTest(success?: AnyFunction, _error?: AnyFunction): VoidOrPromise
}

// The relevant subset of the SQLiteTransaction interface.
export interface Transaction {
  readOnly: boolean
  success(...args: any[]): any
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase implements ProxyWrapper {
  // Private properties are not exposed via the proxy.
  _aliases: {
    [key: DbName]: DbName
  }
  _db: Database
  _hasEnabledPromises: boolean

  // This is the one public property we add to the underlying
  // Database client. Hence calling it our specific name, rather
  // than `notifier` as this way we're less likely to clobber
  // some existing property + allowing the user to manually
  // run `db.electric.notifyCommit()`.
  electric: Notifier

  constructor(db: Database, notifier: Notifier, hasEnabledPromises?: boolean) {
    this._aliases = {}
    this._db = db

    if (hasEnabledPromises !== undefined) {
      this._hasEnabledPromises = hasEnabledPromises
    }
    else {
      this._hasEnabledPromises = this._db.echoTest() instanceof Promise
    }

    this.electric = notifier
  }

  // Used when re-proxying so the proxy code doesn't need
  // to know the property name.
  _setOriginal(db: Database): void {
    this._db = db
  }
  _getOriginal(): Database {
    return this._db
  }

  // Everything goes through `addTransaction`, so we patch
  // it to patch the `tx.success`` function.
  addTransaction(tx: Transaction): void {
    const originalSuccessFn = tx.success
    const notifyCommit = this.electric.notifyCommit.bind(this.electric)

    tx.success = (...args: any[]): any => {
      if (!tx.readOnly) {
        notifyCommit()
      }

      if (!!originalSuccessFn) {
        originalSuccessFn(...args)
      }
    }

    return this._db.addTransaction(tx)
  }

  // Because the plugin also supports attaching multiple databases
  // and running SQL statements against them both, we also hook
  // into `attach` and `detach` to keep a running tally of all
  // the names of the attached databases.
  attach(dbName: DbName, dbAlias: DbName, success?: AnyFunction, error?: AnyFunction): VoidOrPromise {
    const aliases = this._aliases
    const notifier = this.electric
    const hasEnabledPromises = this._hasEnabledPromises
    const originalSuccessFn = success

    const successFn = (...args: any[]): any => {
      aliases[dbAlias] = dbName
      notifier.attach(dbName)

      if (!!originalSuccessFn && !hasEnabledPromises) {
        return originalSuccessFn(...args)
      }
    }

    if (hasEnabledPromises) {
      const retval = ensurePromise(this._db.attach(dbName, dbAlias))

      return retval.then(successFn)
    }

    return this._db.attach(dbName, dbAlias, successFn, error)
  }

  detach(dbAlias: DbName, success?: AnyFunction, error?: AnyFunction): VoidOrPromise {
    const aliases = this._aliases
    const notifier = this.electric
    const hasEnabledPromises = this._hasEnabledPromises
    const originalSuccessFn = success

    const successFn = (...args: any[]): any => {
      const dbName = aliases[dbAlias]
      delete aliases[dbAlias]

      notifier.detach(dbName)

      if (!!originalSuccessFn) {
        return originalSuccessFn(...args)
      }
    }

    if (hasEnabledPromises) {
      const retval = ensurePromise(this._db.detach(dbAlias))

      return retval.then(successFn)
    }

    return this._db.detach(dbAlias, successFn, error)
  }
}

export const electrify = (db: Database, notifier?: Notifier): Database => {
  if (!notifier) {
    notifier = new EmitNotifier(db.dbName)
  }
  const electric = new ElectricDatabase(db, notifier)

  return proxyOriginal(db, electric)
}
