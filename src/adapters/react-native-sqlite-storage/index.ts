import { Notifier } from '../../notifiers/index'
import { EmitNotifier } from '../../notifiers/event'
import { proxyOriginal } from '../../proxy/index'
import { AnyFunction, DbName, VoidOrPromise } from '../../util/types'

import { ElectricSQLitePlugin, SQLitePlugin } from '../sqlite-plugin/index'

export const ensurePromise = (candidate: any): Promise<any> => {
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
export interface Database extends SQLitePlugin {
  // React Native calls the database name `.dbName` using camel case.
  // this is diffferent to Cordova which uses `.dbname`.
  dbName: DbName

  attach(dbName: DbName, dbAlias: DbName, success?: AnyFunction, error?: AnyFunction): VoidOrPromise
  detach(dbAlias: DbName, success?: AnyFunction, error?: AnyFunction): VoidOrPromise

  // XXX we use `echoTest` to detect whether the promises API
  // is enabled. This could be removed if we require the user
  // to just tell us instead.
  echoTest(success?: AnyFunction, _error?: AnyFunction): VoidOrPromise
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase extends ElectricSQLitePlugin {
  // Private properties are not exposed via the proxy.
  _db: Database
  _hasEnabledPromises: boolean

  constructor(db: Database, notifier: Notifier, hasEnabledPromises?: boolean) {
    super(db, notifier)

    this._db = db

    if (hasEnabledPromises !== undefined) {
      this._hasEnabledPromises = hasEnabledPromises
    }
    else {
      this._hasEnabledPromises = this._db.echoTest() instanceof Promise
    }
  }

  // The React Native plugin also supports attaching multiple databases
  // and running SQL statements against them both, so we also hook
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
