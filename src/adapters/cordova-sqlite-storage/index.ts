// N.b.: importing this module is an entrypoint that imports the Cordova
// environment dependencies. Specifically `./filesystems/cordova`. You can
// use the alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import { DEFAULTS } from '../../electric/config'
import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify
} from '../../electric/index'

import { Filesystem } from '../../filesystems/index'
import { CordovaFilesystem } from '../../filesystems/cordova'
import { EmitCommitNotifier } from '../../notifiers/emit'
import { globalRegistry } from '../../satellite/registry'

import { Database, ElectricDatabase } from './database'
import { QueryAdapter } from './query'
import { SatelliteDatabaseAdapter } from './satellite'

const resolveFilesystem = (fs?: Filesystem): Promise<Filesystem> => {
  if (fs !== undefined) {
    return Promise.resolve(fs)
  }

  return CordovaFilesystem.init()
}

export const electrify = (db: Database, opts: ElectrifyOptions = {}): Promise<Database> => {
  const dbName: DbName = db.dbname
  const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace

  const commitNotifier = opts.commitNotifier || new EmitCommitNotifier(dbName)
  const queryAdapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace)
  const satelliteDbAdapter = opts.satelliteDbAdapter || new SatelliteDatabaseAdapter(db)
  const satelliteRegistry = opts.satelliteRegistry || globalRegistry

  const namespace = new ElectricNamespace(commitNotifier, queryAdapter)
  const electric = new ElectricDatabase(db, namespace)

  return resolveFilesystem(opts.filesystem)
    .then(fs => baseElectrify(dbName, db, electric, fs, satelliteDbAdapter, satelliteRegistry))
}
