// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { electrify, ElectrifyOptions } from '../../electric/index'

import { MockMigrator } from '../../migrators/mock'
import { Notifier } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { MockRegistry } from '../../satellite/mock'

import { DatabaseAdapter } from './adapter'
import { Database } from './database'
import { MockDatabase } from './mock'
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
  config = testConfig,
  opts?: ElectrifyOptions
): RetVal<S, N> => {
  const db = new MockDatabase(dbName)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const notifier = (opts?.notifier as N) || new MockNotifier(dbName)
  const migrator = opts?.migrator || new MockMigrator()
  const socketFactory = opts?.socketFactory || new MockSocketFactory()
  const console = opts?.console || new MockConsoleClient()
  const registry = opts?.registry || new MockRegistry()

  const dal = await electrify(
    dbName,
    dbSchemas,
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
