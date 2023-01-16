// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify,
} from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import {
  Database,
  ElectricDatabase,
  ElectricWebSQLDatabase,
  ElectrifiedDatabase,
} from './database'
import { MockDatabase, MockWebSQLDatabase } from './mock'
import { MockSocketFactory } from '../../sockets/mock'
import { MockConsoleClient } from '../../auth/mock'
import { ElectricConfig } from '../../config'

type RetVal<N extends Notifier, D extends Database = Database> = Promise<
  [D, N, ElectrifiedDatabase<D>]
>
const testConfig = { app: 'app', token: 'token' }

export async function initTestable<N extends Notifier = MockNotifier>(
  name: DbName
): RetVal<N, MockDatabase>
export async function initTestable<N extends Notifier = MockNotifier>(
  name: DbName,
  webSql: false,
  config?: ElectricConfig,
  opts?: ElectrifyOptions
): RetVal<N, MockDatabase>
export async function initTestable<N extends Notifier = MockNotifier>(
  name: DbName,
  webSql: true,
  config?: ElectricConfig,
  opts?: ElectrifyOptions
): RetVal<N, MockWebSQLDatabase>

export async function initTestable<N extends Notifier = MockNotifier>(
  dbName: DbName,
  useWebSQLDatabase = false,
  config: ElectricConfig = testConfig,
  opts?: ElectrifyOptions
): RetVal<N> {
  const db = useWebSQLDatabase
    ? new MockWebSQLDatabase(dbName)
    : new MockDatabase(dbName)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const socketFactory = opts?.socketFactory || new MockSocketFactory()
  const console = opts?.console || new MockConsoleClient()
  const registry = opts?.registry || new MockRegistry()

  const namespace = new ElectricNamespace(adapter, notifier)

  let electric: ElectricDatabase | ElectricWebSQLDatabase
  if ('exec' in db) {
    electric = new ElectricWebSQLDatabase(db, namespace)
  } else {
    electric = new ElectricDatabase(db, namespace)
  }

  const electrified = await electrify(
    dbName,
    db,
    electric,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    registry,
    config
  )
  return [db, notifier, electrified as ElectrifiedDatabase]
}
