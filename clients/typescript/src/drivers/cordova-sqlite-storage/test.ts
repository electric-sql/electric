// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types.js'

import { electrify, ElectrifyOptions } from '../../electric/index.js'

import { MockMigrator } from '../../migrators/mock.js'
import { Notifier } from '../../notifiers/index.js'
import { MockNotifier } from '../../notifiers/mock.js'
import { MockRegistry } from '../../satellite/mock.js'

import { DatabaseAdapter } from './adapter.js'
import { Database } from './database.js'
import { MockDatabase } from './mock.js'
import { MockSocket } from '../../sockets/mock.js'
import { ElectricClient } from '../../client/model/client.js'
import { ElectricConfig } from '../../config/index.js'
import { DbSchema } from '../../client/model/index.js'

const testConfig = {
  auth: {
    token: 'test-token',
  },
}

type RetVal<DB extends DbSchema<any>, N extends Notifier> = Promise<
  [Database, N, ElectricClient<DB>]
>

export const initTestable = async <
  DB extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  dbName: DbName,
  dbDescription: DB,
  config: ElectricConfig = testConfig,
  opts?: ElectrifyOptions
): RetVal<DB, N> => {
  const db = new MockDatabase(dbName)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const migrator = opts?.migrator || new MockMigrator()
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
