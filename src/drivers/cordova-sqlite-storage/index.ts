// N.b.: importing this module is an entrypoint that imports the Cordova
// environment dependencies. Specifically `./filesystems/cordova`. You can
// use the alternative entrypoint in `./test` to avoid importing this.
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

export {
  Database,
  DatabaseAdapter,
  ElectricDatabase,
  ElectrifiedDatabase
}

export const electrify = async (db: Database, opts: ElectrifyOptions = {}): Promise<ElectrifiedDatabase> => {
  const dbName: DbName = db.dbname

  const adapter = opts.adapter || new DatabaseAdapter(db)
  const migrator = opts.migrator || new BundleMigrator(adapter, opts.migrations)
  const notifier = opts.notifier || new EventNotifier(dbName)
  const registry = opts.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)
  const electric = new ElectricDatabase(db, namespace)

  const electrified = await baseElectrify(dbName, db, electric, adapter, migrator, notifier, registry)
  return electrified as unknown as ElectrifiedDatabase
}
