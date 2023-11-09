// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types.js'

import { ElectrifyOptions, electrify } from '../../electric/index.js'

import { MockMigrator } from '../../migrators/mock.js'
import { Notifier } from '../../notifiers/index.js'
import { MockNotifier } from '../../notifiers/mock.js'
import { MockRegistry } from '../../satellite/mock.js'

import { DatabaseAdapter } from './adapter.js'
import { Database } from './database.js'
import { MockDatabase } from './mock.js'
import { MockSocket } from '../../sockets/mock.js'
import { ElectricConfig } from '../../config/index.js'
import { ElectricClient } from '../../client/model/client.js'
import { DbSchema } from '../../client/model/index.js'

const testConfig = {
  auth: {
    token: 'test-token',
  },
}

type RetVal<
  S extends DbSchema<any>,
  N extends Notifier,
  D extends Database = Database
> = Promise<[D, N, ElectricClient<S>]>

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
): RetVal<S, N, MockDatabase>
export async function initTestable<
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  dbName: DbName,
  dbDescription: S,
  _useWebSQLDatabase = false,
  config: ElectricConfig = testConfig,
  opts?: ElectrifyOptions
): RetVal<S, N> {
  const db = new MockDatabase(dbName)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const socketFactory = opts?.socketFactory || MockSocket
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
      registry: registry,
    }
  )
  return [db, notifier, dal]
}
