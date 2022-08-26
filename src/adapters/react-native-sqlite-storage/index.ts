import { Notifier } from '../../notifiers/index'
import { EmitNotifier } from '../../notifiers/event'

import { ProxyWrapper, proxyOriginal } from '../../proxy/index'

import { DbName } from '../../util/types'

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

  // XXX Deal with the enablePromise(true) thing.
  addTransaction(tx: Transaction): void
  attach(dbName: DbName, dbAlias: DbName, success?: (...args: any[]) => any, error?: (...args: any[]) => any): any
  detatch(dbAlias: DbName, success?: (...args: any[]) => any, error?: (...args: any[]) => any): any
}

// The relevant subset of the SQLiteTransaction interface.
export interface Transaction {
  readOnly: boolean
  success(...args: any[]): any
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase implements ProxyWrapper {
  // Private properties are not exposed via the proxy.
  _db: Database
  _aliases: {
    [key: DbName]: DbName
  }

  // This is the one public property we add to the underlying
  // Database client. Hence calling it our specific name, rather
  // than `notifier` as this way we're less likely to clobber
  // some existing property + allowing the user to manually
  // run `db.electric.notifyCommit()`.
  electric: Notifier

  constructor(db: Database, notifier: Notifier) {
    this._db = db
    this.electric = notifier

    this._aliases = {}
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

    this._db.addTransaction(tx)
  }

  // Because the plugin also supports attaching multiple databases
  // and running SQL statements against them both, we also hook
  // into `attach` and `detatch` to keep a running tally of all
  // the names of the attached databases.
  attach(dbName: DbName, dbAlias: DbName, success?: (...args: any[]) => any, error?: (...args: any[]) => any) {
    const aliases = this._aliases
    const notifier = this.electric
    const originalSuccessFn = success

    const successFn = (...args: any[]): any => {
      aliases[dbAlias] = dbName
      notifier.attach(dbName)

      if (!!originalSuccessFn) {
        return originalSuccessFn(...args)
      }
    }

    return this._db.attach(dbName, dbAlias, successFn, error)
  }

  detatch(dbAlias: DbName, success?: (...args: any[]) => any, error?: (...args: any[]) => any) {
    const aliases = this._aliases
    const notifier = this.electric
    const originalSuccessFn = success

    const successFn = (...args: any[]): any => {
      const dbName = aliases[dbAlias]
      delete aliases[dbAlias]

      notifier.detatch(dbName)

      if (!!originalSuccessFn) {
        return originalSuccessFn(...args)
      }
    }

    return this._db.detatch(dbAlias, successFn, error)
  }
}

export const electrify = (db: Database, notifier?: Notifier): Database => {
  if (!notifier) {
    notifier = new EmitNotifier(db.dbName)
  }
  const electric = new ElectricDatabase(db, notifier)

  return proxyOriginal(db, electric)
}
