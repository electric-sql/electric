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
import { DalNamespace, DbSchemas } from '../../client/model/dalNamespace'

type RetVal<S extends DbSchemas, N extends Notifier> = Promise<
  [Database, N, DalNamespace<S>]
>

const testConfig = { app: 'app', env: 'default', migrations: [] }

export const initTestable = async <
  S extends DbSchemas,
  N extends Notifier = MockNotifier
>(
  dbName: DbName,
  dbSchemas: S,
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
    dbSchemas,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    registry,
    config
  )

  return [db, notifier, dal]
}
