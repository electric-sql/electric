import { Filesystem } from '../filesystems/index'
import { DbName } from '../util/types'

import { Satellite, SatelliteClient, SatelliteRegistry } from './index'
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

  ensureStarted(dbName: DbName, client: SatelliteClient, fs: Filesystem): Promise<Satellite> {
    const satellites = this._satellites

    if (!(dbName in satellites)) {
      satellites[dbName] = new SatelliteProcess(dbName, client, fs)
    }

    return Promise.resolve(satellites[dbName])
  }

  stop(dbName: DbName): Promise<void> {
    const satellites = this._satellites

    if (dbName in satellites) {
      const satellite = satellites[dbName]

      return satellite.stop()
        .then(() => {
          delete satellites[dbName]
        })
    }

    return Promise.resolve()
  }

  stopAll(): Promise<void> {
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

    return Promise.all(promisesToStop)
      .then(() => {})
  }
}

export const globalRegistry = new GlobalRegistry()
