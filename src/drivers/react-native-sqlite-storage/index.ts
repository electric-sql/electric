// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify
} from '../../electric/index'

import { BundleMigrator } from '../../migrators/bundle'
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectrifiedDatabase } from './database'

export { DatabaseAdapter, ElectricDatabase }
export type { Database, ElectrifiedDatabase }

export const electrify = async (db: Database, promisesEnabled?: boolean, opts?: ElectrifyOptions): Promise<ElectrifiedDatabase> => {
  if (opts === undefined) {
    opts = {}
  }

  const dbName: DbName = db.dbName

  const adapter = opts.adapter || new DatabaseAdapter(db, promisesEnabled)
  const migrator = opts.migrator || new BundleMigrator(adapter, opts.migrations)
  const notifier = opts.notifier || new EventNotifier(dbName)
  const registry = opts.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)
  const electric = new ElectricDatabase(db, namespace, promisesEnabled)

  const electrified = await baseElectrify(dbName, db, electric, adapter, migrator, notifier, registry)
  return electrified as unknown as ElectrifiedDatabase
}
