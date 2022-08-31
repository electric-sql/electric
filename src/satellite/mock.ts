import { Filesystem } from '../filesystems/index'
import { ChangeNotifier } from '../notifiers/index'
import { MockChangeNotifier } from '../notifiers/mock'
import { DbName } from '../util/types'
import { Satellite, SatelliteDatabaseAdapter, SatelliteRegistry } from './index'

export class MockSatellite implements Satellite {
  changeNotifier: ChangeNotifier
  dbAdapter: SatelliteDatabaseAdapter
  dbName: DbName
  fs: Filesystem

  constructor(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem) {
    this.changeNotifier = new MockChangeNotifier(dbName)
    this.dbAdapter = dbAdapter
    this.dbName = dbName
    this.fs = fs
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }
}

class MockRegistry implements SatelliteRegistry {
  _satellites: {
    [key: DbName]: Satellite
  }

  constructor() {
    this._satellites = {}
  }

  ensureStarted(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem): Promise<Satellite> {
    if (!(dbName in this._satellites)) {
      this._satellites[dbName] = new MockSatellite(dbName, dbAdapter, fs)
    }

    return Promise.resolve(this._satellites[dbName])
  }
  stop(dbName: DbName): Promise<void> {
    delete this._satellites[dbName]

    return Promise.resolve()
  }
  stopAll(): Promise<void> {
    this._satellites = {}

    return Promise.resolve()
  }
}

export const mockRegistry = new MockRegistry()
