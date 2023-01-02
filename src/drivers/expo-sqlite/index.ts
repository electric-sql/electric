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
import { addDefaultsToElectricConfig, ElectricConfig } from '../../satellite/config'

import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase, ElectricWebSQLDatabase, ElectrifiedDatabase } from './database'
import { WebSocketReactNativeFactory } from '../../sockets/react-native'

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'
import { ConsoleHttpClient } from '../../auth'

export { DatabaseAdapter, ElectricDatabase, ElectricWebSQLDatabase }
export type { Database, ElectrifiedDatabase }

export const electrify = async (db: Database, config: ElectricConfig, opts?: ElectrifyOptions): Promise<ElectrifiedDatabase> => {
  const dbName: DbName = db._name
  const configWithDefaults = addDefaultsToElectricConfig(config)  

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator = opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketReactNativeFactory()
  const console = opts?.console || new ConsoleHttpClient(configWithDefaults)
  const registry = opts?.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)

  let electric: ElectricDatabase | ElectricWebSQLDatabase
  if ('exec' in db) {
    electric = new ElectricWebSQLDatabase(db, namespace)
  }
  else {
    electric = new ElectricDatabase(db, namespace)
  }

  const electrified = await baseElectrify(dbName, db, electric, adapter, migrator, notifier, socketFactory, console, registry, config)
  return electrified as unknown as ElectrifiedDatabase
}
