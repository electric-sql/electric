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
import { MockSocketFactory } from '../../sockets/mock'
import { MockConsoleClient } from '../../auth/mock'
import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model'

type RetVal<S extends DbSchema<any>, N extends Notifier> = Promise<
  [Database, N, ElectricClient<S>]
>

const testConfig = { app: 'app', env: 'default', migrations: [] }

export const initTestable = async <
  S extends DbSchema<any>,
  N extends Notifier = MockNotifier
>(
  dbName: DbName,
  dbDescription: S,
  promisesEnabled = false,
  config = testConfig,
  opts?: ElectrifyOptions
): RetVal<S, N> => {
  let db = new MockDatabase(dbName)
  if (promisesEnabled) db = enablePromiseRuntime(db)

  const adapter = opts?.adapter || new DatabaseAdapter(db, promisesEnabled)
  const migrator = opts?.migrator || new MockMigrator()
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const socketFactory = opts?.socketFactory || new MockSocketFactory()
  const console = opts?.console || new MockConsoleClient()
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
      console: console,
      registry: registry,
    }
  )

  return [db, notifier, dal]
}
