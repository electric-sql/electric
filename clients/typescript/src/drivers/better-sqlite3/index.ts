// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.

import { hydrateConfig, ElectricConfig } from '../../config/index'

import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify,
  startSatellite,
  ExtendedDB,
} from '../../electric/index'

import { BundleMigrator } from '../../migrators/bundle'
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'

import { WebSocketNodeFactory } from '../../sockets/node'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectrifiedDatabase } from './database'
import { ConsoleHttpClient } from '../../auth'

export { ElectricDatabase, DatabaseAdapter }
export type { Database, ElectrifiedDatabase }

export const electrify = async <T extends Database>(
  db: T,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectrifiedDatabase<T>> => {
  const dbName: DbName = db.name
  const configWithDefaults = hydrateConfig(config)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketNodeFactory()
  const console = opts?.console || new ConsoleHttpClient(configWithDefaults)
  const registry = opts?.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)
  const electric = new ElectricDatabase(db, namespace)

  const electrified = await baseElectrify(
    dbName,
    db,
    electric,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    registry,
    configWithDefaults
  )
  return electrified as ElectrifiedDatabase<T>
}

export const start = async <T extends Database>(
  db: T,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ExtendedDB<T>> => {
  const dbName: DbName = db.name
  const configWithDefaults = hydrateConfig(config)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketNodeFactory()
  const console = opts?.console || new ConsoleHttpClient(configWithDefaults)
  const registry = opts?.registry || globalRegistry
  const namespace = new ElectricNamespace(adapter, notifier)

  await startSatellite(
    dbName,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    registry,
    configWithDefaults
  )

  return {
    ...db,
    electric: namespace,
  }
}
