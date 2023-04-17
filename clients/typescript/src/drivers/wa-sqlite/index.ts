import { DatabaseAdapter } from './adapter'
import { ElectricDatabase } from './database'
import { ElectricConfig, hydrateConfig } from '../../config'
import { ElectricNamespace, ElectrifyOptions } from '../../electric'
import { EventNotifier } from '../../notifiers'
import { WebSocketReactNativeFactory } from '../../sockets/react-native'
import { ConsoleHttpClient } from '../../auth'
import { globalRegistry } from '../../satellite'
import { BundleMigrator } from '../../migrators'
import { setLogLevel } from '../../util/debug'

export { DatabaseAdapter }
export type { ElectricDatabase }

export const start = async (
  dbName: string,
  sqliteDistPath: string,
  config: ElectricConfig,
  opts?: ElectrifyOptions
) => {
  const db = await ElectricDatabase.init(dbName, sqliteDistPath)
  const configWithDefaults = hydrateConfig(config)

  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new BundleMigrator(adapter, config.migrations)
  const notifier = opts?.notifier || new EventNotifier(dbName)
  const socketFactory = opts?.socketFactory || new WebSocketReactNativeFactory()
  const console = opts?.console || new ConsoleHttpClient(configWithDefaults)
  const registry = opts?.registry || globalRegistry

  const namespace = new ElectricNamespace(adapter, notifier)

  setLogLevel(config.debug ? 'TRACE' : 'WARN')

  await registry.ensureStarted(
    dbName,
    adapter,
    migrator,
    notifier,
    socketFactory,
    console,
    configWithDefaults
  )

  return {
    db: db,
    electric: namespace,
  }
}
