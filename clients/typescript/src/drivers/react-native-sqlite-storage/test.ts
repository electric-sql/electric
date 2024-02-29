// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database } from './index'
import { enablePromiseRuntime, MockDatabase } from './mock'
import { MockSocket } from '../../sockets/mock'
import { ElectricClient } from '../../client/model/client'
import { ElectricConfig } from '../../config'
import { DbSchema } from '../../client/model'

const testToken = 'test-token'

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
  config: ElectricConfig = {},
  opts?: ElectrifyOptions
): RetVal<S, N> => {
  let db = new MockDatabase(dbName)
  if (promisesEnabled) db = enablePromiseRuntime(db)

  const adapter = opts?.adapter || new DatabaseAdapter(db, promisesEnabled)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const socketFactory = opts?.socketFactory || MockSocket
  const registry = opts?.registry || new MockRegistry()

  const client = await baseElectrify(
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

  await client.connect(testToken)

  return [db, notifier, client]
}
