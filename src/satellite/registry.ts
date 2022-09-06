import { Filesystem } from '../filesystems/index'
import { DbName } from '../util/types'

import { Satellite, SatelliteDatabaseAdapter, SatelliteRegistry } from './index'
import { SatelliteProcess } from './process'

// XXX Todo: implement locking so that you don't have multiple concurrent
// calls acting on the same dbName at the same time.
class GlobalRegistry implements SatelliteRegistry {
  _satellites: {
    [key: DbName]: Satellite
  }

  constructor() {
    this._satellites = {}
  }

  // XXX there's scope here to block on the process initialisation if need be.
  async ensureStarted(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem): Promise<Satellite> {
    const satellites = this._satellites

    if (!(dbName in satellites)) {
      satellites[dbName] = new SatelliteProcess(dbName, dbAdapter, fs)
    }

    return satellites[dbName]
  }

  // XXX there's scope here to block on the process initialisation if need be.
  async ensureAlreadyStarted(dbName: DbName): Promise<Satellite> {
    const satellites = this._satellites

    if (!(dbName in satellites)) {
      throw new Error(`Satellite not running for db: ${dbName}`)
    }

    return satellites[dbName]
  }

  async stop(dbName: DbName): Promise<void> {
    const satellites = this._satellites

    if (dbName in satellites) {
      const satellite = satellites[dbName]

      await satellite.stop()
      delete satellites[dbName]
    }
  }

  async stopAll(): Promise<void> {
    const promisesToStop = []
    const satellites = this._satellites

    for (const [dbName, satellite] of Object.entries(satellites)) {
      promisesToStop.push(
        satellite.stop()
          .then(() => {
            delete satellites[dbName]
          })
      )
    }

    await Promise.all(promisesToStop)
  }
}

export const globalRegistry = new GlobalRegistry()
