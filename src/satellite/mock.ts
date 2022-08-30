import { Filesystem } from '../filesystems/index'
import { ChangeNotifier } from '../notifiers/index'
import { MockChangeNotifier } from '../notifiers/mock'
import { DbName } from '../util/types'
import { Satellite, SatelliteClient, SatelliteRegistry } from './index'

export class MockSatellite implements Satellite {
  dbName: DbName
  client: SatelliteClient
  fs: Filesystem
  notifier: ChangeNotifier

  constructor(dbName: DbName, client: SatelliteClient, fs: Filesystem) {
    this.dbName = dbName

    this.client = client
    this.fs = fs

    this.notifier = new MockChangeNotifier(dbName)
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

  ensureStarted(dbName: DbName, client: SatelliteClient, fs: Filesystem): Promise<Satellite> {
    if (!(dbName in this._satellites)) {
      this._satellites[dbName] = new MockSatellite(dbName, client, fs)
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
