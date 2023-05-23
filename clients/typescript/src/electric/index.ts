import { ElectricConfig, hydrateConfig } from '../config/index'
import { DatabaseAdapter } from '../electric/adapter'
import { BundleMigrator, Migrator } from '../migrators/index'
import { EventNotifier, Notifier } from '../notifiers/index'
import { globalRegistry, Registry } from '../satellite/index'
import { SocketFactory } from '../sockets/index'
import { DbName } from '../util/types'
import { setLogLevel } from '../util/debug'
import { ElectricNamespace } from './namespace'
import { ElectricClient } from '../client/model/client'
import { DbSchema } from '../client/model/schema'
import { AuthConfig } from '../auth/index'

export { ElectricNamespace }

// These are the options that should be provided to the adapter's electrify
// entrypoint. They are all optional to optionally allow different / mock
// implementations to be passed in to facilitate testing.
export interface ElectrifyOptions {
  adapter?: DatabaseAdapter
  migrator?: Migrator
  notifier?: Notifier
  socketFactory?: SocketFactory
  registry?: Registry
}

/**
 * This is the primary `electrify()` endpoint that the individual drivers
 * call once they've constructed their implementations. This function can
 * also be called directly by tests that don't want to go via the adapter
 * entrypoints in order to avoid loading the environment dependencies.
 */
export const electrify = async <DB extends DbSchema<any>>(
  dbName: DbName,
  dbDescription: DB,
  adapter: DatabaseAdapter,
  socketFactory: SocketFactory,
  config: ElectricConfig,
  authConfig: AuthConfig,
  opts?: Omit<ElectrifyOptions, 'adapter' | 'socketFactory'>
): Promise<ElectricClient<DB>> => {
  setLogLevel(config.debug ? 'TRACE' : 'WARN')

  const configWithDefaults = hydrateConfig(config)
  const migrator =
    opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const registry = opts?.registry || globalRegistry

  const electric = new ElectricNamespace(adapter, notifier)
  const namespace = ElectricClient.create(dbDescription, electric) // extends the electric namespace with a `dal` property for the data access library

  await registry.ensureStarted(
    dbName,
    adapter,
    migrator,
    notifier,
    socketFactory,
    configWithDefaults,
    authConfig
  )

  return namespace
}
