// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.

import { hydrateConfig, ElectricConfig } from '../../config/index'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { BundleMigrator } from '../../migrators/bundle'
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'

import { WebSocketNodeFactory } from '../../sockets/node'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { Database } from './database'
import { ConsoleHttpClient } from '../../auth'
import { DalNamespace, DbSchemas } from '../../client/model/dalNamespace'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <S extends DbSchemas, T extends Database>(
  db: T,
  dbSchemas: S,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<DalNamespace<S>> => {
  const dbName: DbName = db.name
  const configWithDefaults = hydrateConfig(config)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketNodeFactory()
  const console = opts?.console || new ConsoleHttpClient(configWithDefaults)
  const registry = opts?.registry || globalRegistry

  const namespace = await baseElectrify(
    dbName,
    dbSchemas,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    registry,
    configWithDefaults
  )

  return namespace
}
