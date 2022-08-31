import { Filesystem } from '../filesystems/index'
import { ChangeNotifier } from '../notifiers/index'
import { EmitChangeNotifier } from '../notifiers/emit'
import { AnyFunction, DbName } from '../util/types'
import { Satellite, SatelliteDatabaseAdapter } from './index'

export class SatelliteProcess implements Satellite {
  changeNotifier: ChangeNotifier
  dbName: DbName
  dbAdapter: SatelliteDatabaseAdapter
  fs: Filesystem

  constructor(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem) {
    this.changeNotifier = new EmitChangeNotifier(dbName)
    this.dbAdapter = dbAdapter
    this.dbName = dbName
    this.fs = fs
  }

  stop(): Promise<void> {
    return new Promise((resolve: AnyFunction) => {
      throw "NotImplemented"

      resolve()
    })
  }
}
