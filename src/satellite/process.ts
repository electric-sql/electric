import { Filesystem } from '../filesystems/index'
import { ChangeNotifier } from '../notifiers/index'
import { EmitChangeNotifier } from '../notifiers/emit'
import { AnyFunction, DbName } from '../util/types'
import { Satellite, SatelliteClient } from './index'

export class SatelliteProcess implements Satellite {
  dbName: DbName
  client: SatelliteClient
  fs: Filesystem
  notifier: ChangeNotifier

  constructor(dbName: DbName, client: SatelliteClient, fs: Filesystem) {
    this.dbName = dbName

    this.client = client
    this.fs = fs

    this.notifier = new EmitChangeNotifier(dbName)
  }

  stop(): Promise<void> {
    return new Promise((resolve: AnyFunction) => {
      throw "NotImplemented"

      resolve()
    })
  }
}
