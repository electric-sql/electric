// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { BundleMigrator } from '../../migrators/bundle'
import { EventNotifier } from '../../notifiers/event'
import { globalRegistry } from '../../satellite/registry'

import { DatabaseAdapter } from './adapter'
import { ElectricConfig, hydrateConfig } from '../../config'
import { Database } from './database'
import { WebSocketReactNativeFactory } from '../../sockets/react-native'

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'

// Provide implementation for global uuid()
import uuid from 'react-native-uuid'
;(function (global: any) {
  global['uuid'] = uuid.v4
})(
  typeof global == '' + void 0
    ? typeof self == '' + void 0
      ? this || {}
      : self
    : global
)

import { ConsoleHttpClient } from '../../auth'
import { DalNamespace, DbSchemas } from '../../client/model/dalNamespace'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <T extends Database, S extends DbSchemas>(
  db: T,
  dbSchemas: S,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<DalNamespace<S>> => {
  const dbName: DbName = db._name!
  const configWithDefaults = hydrateConfig(config)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketReactNativeFactory()
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
