import { Filesystem } from '../filesystems/index'
import { Notifier } from '../notifiers/index'
import { DbName } from '../util/types'
import { Satellite, SatelliteDatabaseAdapter, SatelliteRegistry } from './index'

export class MockSatellite implements Satellite {
  dbAdapter: SatelliteDatabaseAdapter
  dbName: DbName
  fs: Filesystem
  notifier: Notifier

  constructor(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem, notifier: Notifier) {
    this.dbAdapter = dbAdapter
    this.dbName = dbName
    this.fs = fs
    this.notifier = notifier
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

  async ensureStarted(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem, notifier: Notifier): Promise<Satellite> {
    const satellites = this._satellites

    if (!(dbName in satellites)) {
      satellites[dbName] = new MockSatellite(dbName, dbAdapter, fs, notifier)
    }

    return satellites[dbName]
  }
  async ensureAlreadyStarted(dbName: DbName): Promise<Satellite> {
    const satellites = this._satellites

    if (!(dbName in satellites)) {
      throw new Error(`Satellite not running for db: ${dbName}`)
    }

    return satellites[dbName]
  }
  async stop(dbName: DbName): Promise<void> {
    delete this._satellites[dbName]
  }
  async stopAll(): Promise<void> {
    this._satellites = {}
  }
}

export const mockRegistry = new MockRegistry()
