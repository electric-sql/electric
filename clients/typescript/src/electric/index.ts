import { ElectricConfig } from '../config/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { ConsoleClient, Registry } from '../satellite/index'
import { SocketFactory } from '../sockets/index'
import { DbName } from '../util/types'
import { setLogLevel } from '../util/debug'
import { ElectricNamespace } from './namespace'
import {
  buildDalNamespace,
  DalNamespace,
  DbSchemas,
} from '../client/model/dalNamespace'

export { ElectricNamespace }

// These are the options that should be provided to the adapter's electrify
// entrypoint. They are all optional to optionally allow different / mock
// implementations to be passed in to facilitate testing.
export interface ElectrifyOptions {
  adapter?: DatabaseAdapter
  migrator?: Migrator
  notifier?: Notifier
  socketFactory?: SocketFactory
  console?: ConsoleClient
  registry?: Registry
}

/**
 * This is the primary `electrify()` endpoint that the individual drivers
 * call once they've constructed their implementations. This function can
 * also be called directly by tests that don't want to go via the adapter
 * entrypoints in order to avoid loading the environment dependencies.
 */
export const electrify = async <S extends DbSchemas>(
  dbName: DbName,
  dbSchemas: S,
  adapter: DatabaseAdapter,
  migrator: Migrator,
  notifier: Notifier,
  socketFactory: SocketFactory,
  console: ConsoleClient,
  registry: Registry,
  config: ElectricConfig
): Promise<DalNamespace<S>> => {
  setLogLevel(config.debug ? 'TRACE' : 'WARN')

  const electric = new ElectricNamespace(adapter, notifier)
  const namespace = buildDalNamespace(dbSchemas, electric) // extends the electric namespace with a `dal` field

  await registry.ensureStarted(
    dbName,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    config
  )

  return namespace
}
