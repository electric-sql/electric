// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { ElectricNamespace, ElectrifyOptions, electrify } from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectricWebSQLDatabase, ElectrifiedDatabase } from './database'
import { MockDatabase, MockWebSQLDatabase } from './mock'

type RetVal = Promise<[Database, Notifier, ElectrifiedDatabase]>
interface Opts extends ElectrifyOptions {
  enablePromises?: boolean
}

export const initTestable = async (dbName: DbName, useWebSQLDatabase: boolean = false, opts: Opts = {}): RetVal => {
  const db = useWebSQLDatabase
    ? new MockWebSQLDatabase(dbName)
    : new MockDatabase(dbName)

  const adapter = opts.adapter || new DatabaseAdapter(db)
  const migrator = opts.migrator || new MockMigrator()
  const notifier = opts.notifier || new MockNotifier(dbName)
  const registry = opts.registry || new MockRegistry()

  const namespace = new ElectricNamespace(adapter, notifier)

  let electric: ElectricDatabase | ElectricWebSQLDatabase
  if ('exec' in db) {
    electric = new ElectricWebSQLDatabase(db, namespace)
  }
  else {
    electric = new ElectricDatabase(db, namespace)
  }

  const electrified = await electrify(dbName, db, electric, adapter, migrator, notifier, registry)
  return [db, notifier, electrified as unknown as ElectrifiedDatabase]
}
