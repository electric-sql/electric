// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types.js'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index.js'

import { MockMigrator } from '../../migrators/mock.js'
import { Notifier } from '../../notifiers/index.js'
import { MockNotifier } from '../../notifiers/mock.js'
import { MockRegistry } from '../../satellite/mock.js'

import { DatabaseAdapter } from './adapter.js'
import { Database } from './index.js'
import { enablePromiseRuntime, MockDatabase } from './mock.js'
import { MockSocket } from '../../sockets/mock.js'
import { ElectricClient } from '../../client/model/client.js'
import { ElectricConfig } from '../../config/index.js'
import { DbSchema } from '../../client/model/index.js'

const testConfig = {
  auth: {
    token: 'test-token',
  },
}

type RetVal<S extends DbSchema<any>, N extends Notifier> = Promise<
  [Database, N, ElectricClient<S>]
>

export const initTestable = async <
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  dbName: DbName,
  dbDescription: S,
  promisesEnabled = false,
  config: ElectricConfig = testConfig,
  opts?: ElectrifyOptions
): RetVal<S, N> => {
  let db = new MockDatabase(dbName)
  if (promisesEnabled) db = enablePromiseRuntime(db)

  const adapter = opts?.adapter || new DatabaseAdapter(db, promisesEnabled)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const socketFactory = opts?.socketFactory || MockSocket
  const registry = opts?.registry || new MockRegistry()

  const dal = await baseElectrify(
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
