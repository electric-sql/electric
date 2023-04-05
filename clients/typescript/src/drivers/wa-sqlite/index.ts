import { DatabaseAdapter } from './adapter'
import { ElectricDatabase } from './database'
import { ElectricConfig } from '../../config'
import { electrify as baseElectrify, ElectrifyOptions } from '../../electric'
import { WebSocketReactNativeFactory } from '../../sockets/react-native'
import { DalNamespace, DBDescription } from '../../client/model'
import { Database } from './database'

export { DatabaseAdapter, ElectricDatabase }
export type { Database }

export const electrify = async <
  T extends Database,
  DB extends DBDescription<any>
>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<DalNamespace<DB>> => {
  const dbName = db.name
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || new WebSocketReactNativeFactory()

  const namespace = await baseElectrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    config,
    opts
  )

  return namespace
}
