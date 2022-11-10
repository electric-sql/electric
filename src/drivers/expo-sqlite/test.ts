// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { ElectricNamespace, ElectrifyOptions, electrify } from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier} from '../../notifiers/mock'
import { ElectricConfig } from '../../satellite/config'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectricWebSQLDatabase, ElectrifiedDatabase } from './database'
import { MockDatabase, MockWebSQLDatabase } from './mock'
import { MockSocket } from '../../sockets/mock'

type RetVal = Promise<[Database, Notifier, ElectrifiedDatabase]>
const testConfig = {app: "app", env: "test", token: "token", replication: {address: "", port: 0}}

export const initTestable = async (dbName: DbName, useWebSQLDatabase: boolean = false, config: ElectricConfig = testConfig, opts?: ElectrifyOptions): RetVal => {
  const db = useWebSQLDatabase
    ? new MockWebSQLDatabase(dbName)
    : new MockDatabase(dbName)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = opts?.notifier || new MockNotifier(dbName)
  const socket = opts?.socket || new MockSocket()
  const registry = opts?.registry || new MockRegistry()

  const namespace = new ElectricNamespace(adapter, notifier)

  let electric: ElectricDatabase | ElectricWebSQLDatabase
  if ('exec' in db) {
    electric = new ElectricWebSQLDatabase(db, namespace)
  }
  else {
    electric = new ElectricDatabase(db, namespace)
  }

  const electrified = await electrify(dbName, db, electric, adapter, migrator, notifier, socket, registry, config)
  return [db, notifier, electrified as unknown as ElectrifiedDatabase]
}
