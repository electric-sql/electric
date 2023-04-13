// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { ElectrifyOptions, electrify } from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database } from './database'
import { MockDatabase, MockWebSQLDatabase } from './mock'
import { MockSocketFactory } from '../../sockets/mock'
import { MockConsoleClient } from '../../auth/mock'
import { ElectricConfig } from '../../config'
import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model'

type RetVal<
  S extends DbSchema<any>,
  N extends Notifier,
  D extends Database = Database
> = Promise<[D, N, ElectricClient<S>]>
const testConfig = { app: 'app', env: 'default', migrations: [] }

export async function initTestable<
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(name: DbName, dbDescription: S): RetVal<S, N, MockDatabase>
export async function initTestable<
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  name: DbName,
  dbDescription: S,
  webSql: false,
  config?: ElectricConfig,
  opts?: ElectrifyOptions
): RetVal<S, N, MockDatabase>
export async function initTestable<
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  name: DbName,
  dbDescription: S,
  webSql: true,
  config?: ElectricConfig,
  opts?: ElectrifyOptions
): RetVal<S, N, MockWebSQLDatabase>

export async function initTestable<
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  dbName: DbName,
  dbDescription: S,
  useWebSQLDatabase = false,
  config: ElectricConfig = testConfig,
  opts?: ElectrifyOptions
): RetVal<S, N> {
  const db = useWebSQLDatabase
    ? new MockWebSQLDatabase(dbName)
    : new MockDatabase(dbName)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const socketFactory = opts?.socketFactory || new MockSocketFactory()
  const console = opts?.console || new MockConsoleClient()
  const registry = opts?.registry || new MockRegistry()

  const dal = await electrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    config,
    {
      notifier: notifier,
      migrator: migrator,
      console: console,
      registry: registry,
    }
  )
  return [db, notifier, dal]
}
