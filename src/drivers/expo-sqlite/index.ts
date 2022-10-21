// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify
} from '../../electric/index'

import { BundleMigrator } from '../../migrators/bundle'
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectricWebSQLDatabase, ElectrifiedDatabase } from './database'
import { WebSocketReactNative } from '../../sockets/react-native'

export { DatabaseAdapter, ElectricDatabase, ElectricWebSQLDatabase }
export type { Database, ElectrifiedDatabase }

export const electrify = async (db: Database, opts: ElectrifyOptions): Promise<ElectrifiedDatabase> => {  
  const dbName: DbName = db._name

  const adapter = opts.adapter || new DatabaseAdapter(db)
  const migrator = opts.migrator || new BundleMigrator(adapter, opts.migrations)
  const notifier = opts.notifier || new EventNotifier(dbName)
  const socket = opts.socket || new WebSocketReactNative()
  const registry = opts.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)

  let electric: ElectricDatabase | ElectricWebSQLDatabase
  if ('exec' in db) {
    electric = new ElectricWebSQLDatabase(db, namespace)
  }
  else {
    electric = new ElectricDatabase(db, namespace)
  }

  const electrified = await baseElectrify(dbName, db, electric, adapter, migrator, notifier, socket, registry, opts)
  return electrified as unknown as ElectrifiedDatabase
}
