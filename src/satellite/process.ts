import { Filesystem } from '../filesystems/index'
import { Notifier } from '../notifiers/index'
import { AnyFunction, DbName } from '../util/types'

import { Satellite, SatelliteDatabaseAdapter } from './index'

export class SatelliteProcess implements Satellite {
  dbName: DbName
  dbAdapter: SatelliteDatabaseAdapter
  fs: Filesystem
  notifier: Notifier

  constructor(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem, notifier: Notifier) {
    this.dbAdapter = dbAdapter
    this.dbName = dbName
    this.fs = fs
    this.notifier = notifier
  }

  stop(): Promise<void> {
    return new Promise((resolve: AnyFunction) => {
      throw "NotImplemented"

      resolve()
    })
  }
}
