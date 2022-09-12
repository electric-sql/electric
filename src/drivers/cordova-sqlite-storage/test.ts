// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { ElectricNamespace, ElectrifyOptions, electrify } from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase } from './database'
import { MockDatabase } from './mock'

type RetVal = Promise<[Database, Notifier, Database]>

export const initTestable = (dbName: DbName, opts: ElectrifyOptions = {}): RetVal => {
  const db = new MockDatabase(dbName)

  const adapter = opts.adapter || new DatabaseAdapter(db)
  const notifier = opts.notifier || new MockNotifier(dbName)
  const migrator = opts.migrator || new MockMigrator()
  const registry = opts.registry || new MockRegistry()

  const namespace = new ElectricNamespace(adapter, notifier)
  const electric = new ElectricDatabase(db, namespace)

  return electrify(dbName, db, electric, adapter, migrator, notifier, registry)
    .then((electrified) => [db, notifier, electrified])
}
