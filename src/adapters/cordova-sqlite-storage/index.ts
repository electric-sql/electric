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
import { SatelliteClient } from './satellite'

const resolveFilesystem = (fs?: Filesystem): Promise<Filesystem> => {
  if (fs !== undefined) {
    return Promise.resolve(fs)
  }

  return CordovaFilesystem.init()
}

export const electrify = (db: Database, opts: ElectrifyOptions = {}): Promise<Database> => {
  const dbName: DbName = db.dbname
  const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace
  const adapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace)
  const client = opts.satelliteClient || new SatelliteClient(db)
  const notifier = opts.notifier || new EmitCommitNotifier(dbName)
  const registry = opts.satelliteRegistry || globalRegistry

  const namespace = new ElectricNamespace(notifier, adapter)
  const electric = new ElectricDatabase(db, namespace)

  return resolveFilesystem(opts.filesystem)
    .then(fs => baseElectrify(dbName, db, electric, client, fs, registry))
}
