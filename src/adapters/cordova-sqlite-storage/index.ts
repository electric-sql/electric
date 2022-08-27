import { Notifier } from '../../notifiers/index'
import { EmitNotifier } from '../../notifiers/event'
import { proxyOriginal } from '../../proxy/index'
import { DbName } from '../../util/types'

import { ElectricSQLitePlugin, SQLitePlugin } from '../sqlite-plugin/index'

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export interface Database extends SQLitePlugin {
  // Cordova calls the database name `.dbname` using camel case.
  // this is diffferent to React Native which uses `.dbname`.
  dbname: DbName
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase extends ElectricSQLitePlugin {
  // Private properties are not exposed via the proxy.
  _db: Database

  constructor(db: Database, notifier: Notifier) {
    super(db, notifier)

    this._db = db
  }
}

export const electrify = (db: Database, notifier?: Notifier): Database => {
  if (!notifier) {
    notifier = new EmitNotifier(db.dbname)
  }
  const electric = new ElectricDatabase(db, notifier)

  return proxyOriginal(db, electric)
}
