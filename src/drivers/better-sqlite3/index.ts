// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.
import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { BundleMigrator } from '../../migrators/bundle'
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'
import { ElectricConfig } from '../../satellite/config'
import { WebSocketNodeFactory } from '../../sockets/node'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectrifiedDatabase } from './database'

export { ElectricDatabase, DatabaseAdapter }
export type { Database, ElectrifiedDatabase }

export const electrify = async (db: Database, config: ElectricConfig, opts?: ElectrifyOptions): Promise<ElectrifiedDatabase> => {
  const dbName: DbName = db.name

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator = opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketNodeFactory()
  const registry = opts?.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)
  const electric = new ElectricDatabase(db, namespace)

  const electrified = await baseElectrify(dbName, db, electric, adapter, migrator, notifier, socketFactory, registry, config)
  return electrified as unknown as ElectrifiedDatabase
}
