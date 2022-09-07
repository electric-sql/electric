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
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'

import { Database, ElectricDatabase } from './database'
import { QueryAdapter } from './query'
import { SatelliteDatabaseAdapter } from './satellite'

export const electrify = (db: Database, promisesEnabled?: boolean, opts?: ElectrifyOptions): Promise<Database> => {
  if (opts === undefined) {
    opts = {}
  }

  const dbName: DbName = db.dbName
  const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace

  const notifier = opts.notifier || new EventNotifier(dbName)
  const fs = opts.filesystem || new ReactNativeFilesystem()
  const queryAdapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace, promisesEnabled)
  const satelliteDbAdapter = opts.satelliteDbAdapter || new SatelliteDatabaseAdapter(db, promisesEnabled)
  const satelliteRegistry = opts.satelliteRegistry || globalRegistry

  const namespace = new ElectricNamespace(notifier, queryAdapter)
  const electric = new ElectricDatabase(db, namespace, promisesEnabled)

  return baseElectrify(dbName, db, electric, fs, notifier, satelliteDbAdapter, satelliteRegistry)
}
