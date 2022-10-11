// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { ElectricNamespace, ElectrifyOptions, electrify } from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectrifiedDatabase } from './database'
import { MockDatabase, enablePromiseRuntime } from './mock'
import { MockSocket } from '../../sockets/mock'

type RetVal = Promise<[Database, Notifier, ElectrifiedDatabase]>
interface Opts extends ElectrifyOptions {
  enablePromises?: boolean
}

export const initTestable = async (dbName: DbName, opts: Opts = {}): RetVal => {
  const mockDb = new MockDatabase(dbName)
  const db = opts.enablePromises === true
    ? enablePromiseRuntime(mockDb)
    : mockDb

  const adapter = opts.adapter || new DatabaseAdapter(db)
  const migrator = opts.migrator || new MockMigrator()
  const notifier = opts.notifier || new MockNotifier(dbName)
  const socket = opts.socket || new MockSocket()
  const registry = opts.registry || new MockRegistry()

  const namespace = new ElectricNamespace(adapter, notifier)
  const electric = new ElectricDatabase(db, namespace)

  const electrified = await electrify(dbName, db, electric, adapter, migrator, notifier, socket, registry)
  return [db, notifier, electrified as unknown as ElectrifiedDatabase]
}
