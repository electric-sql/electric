import { Filesystem } from '../filesystems/index'
import { AnyFunction, DbName } from '../util/types'

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

    return new Promise((resolve: AnyFunction) => {
      if (!(dbName in satellites)) {
        satellites[dbName] = new SatelliteProcess(dbName, client, fs)
      }

      resolve(satellites[dbName])
    })
  }

  stop(dbName: DbName): Promise<void> {
    const satellites = this._satellites

    return new Promise((resolve: AnyFunction) => {
      if (dbName in satellites) {
        const satellite = satellites[dbName]

        satellite.stop().then(() => {
          delete satellites[dbName]

          resolve()
        })
      }
      else {
        resolve()
      }
    })
  }

  stopAll(): Promise<void> {
    const satellites = this._satellites

    return new Promise((resolve: AnyFunction) => {
      const promisesToStop = []

      for (const [dbName, satellite] of Object.entries(satellites)) {
        promisesToStop.push(
          satellite.stop().then(() => {
            delete satellites[dbName]
          })
        )
      }

      Promise.all(promisesToStop).then(() => resolve())
    })
  }
}

export const globalRegistry = new GlobalRegistry()
