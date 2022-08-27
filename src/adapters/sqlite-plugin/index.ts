import { Notifier } from '../../notifiers/index'
import { ProxyWrapper } from '../../proxy/index'
import { DbName } from '../../util/types'

// The common subset of the SQLitePlugin database client API
// shared by Cordova and React Native.
export interface SQLitePlugin {
  databaseFeatures: {
    isSQLitePluginDatabase: true
  }
  openDBs: {
    [key: DbName]: 'INIT' | 'OPEN'
  }

  addTransaction(tx: SQLitePluginTransaction): void
}

// The relevant subset of the SQLitePluginTransaction interface.
export interface SQLitePluginTransaction {
  readOnly: boolean
  success(...args: any[]): any
}

// Abstract class designed to be extended by concrete
// implementations for Cordova and React Native.
export abstract class ElectricSQLitePlugin implements ProxyWrapper {
  // Private properties are not exposed via the proxy.
  _aliases: {
    [key: DbName]: DbName
  }
  _db: SQLitePlugin

  // This is the one public property we add to the underlying
  // Database client. Hence calling it our specific name, rather
  // than `notifier` as this way we're less likely to clobber
  // some existing property + allowing the user to manually
  // run `db.electric.notifyCommit()`.
  electric: Notifier

  constructor(db: SQLitePlugin, notifier: Notifier) {
    this._aliases = {}
    this._db = db

    this.electric = notifier
  }

  // Used when re-proxying so the proxy code doesn't need
  // to know the property name.
  _setOriginal(db: SQLitePlugin): void {
    this._db = db
  }
  _getOriginal(): SQLitePlugin {
    return this._db
  }

  // Everything goes through `addTransaction`, so we patch
  // it to patch the `tx.success`` function.
  addTransaction(tx: SQLitePluginTransaction): void {
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
}
