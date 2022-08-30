// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import { DEFAULTS } from '../../electric/config'
import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify
} from '../../electric/index'

import { ReactNativeFilesystem } from '../../filesystems/react-native'
import { EmitCommitNotifier } from '../../notifiers/emit'
import { globalRegistry } from '../../satellite/registry'

import { Database, ElectricDatabase } from './database'
import { QueryAdapter } from './query'
import { SatelliteClient } from './satellite'

export const electrify = (db: Database, promisesEnabled?: boolean, opts?: ElectrifyOptions): Promise<Database> => {
  if (opts === undefined) {
    opts = {}
  }

  const dbName: DbName = db.dbName
  const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace
  const adapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace, promisesEnabled)
  const client = opts.satelliteClient || new SatelliteClient(db, promisesEnabled)
  const fs = opts.filesystem || new ReactNativeFilesystem()
  const notifier = opts.notifier || new EmitCommitNotifier(dbName)
  const registry = opts.satelliteRegistry || globalRegistry

  const namespace = new ElectricNamespace(notifier, adapter)
  const electric = new ElectricDatabase(db, namespace, promisesEnabled)

  return baseElectrify(dbName, db, electric, client, fs, registry)
}
