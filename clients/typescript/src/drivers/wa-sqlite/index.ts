import { DatabaseAdapter } from './adapter.js'
import { ElectricDatabase } from './database.js'
import { ElectricConfig } from '../../config/index.js'
import {
  electrify as baseElectrify,
  ElectrifyOptions,
} from '../../electric/index.js'
import { WebSocketWeb } from '../../sockets/web.js'
import { ElectricClient, DbSchema } from '../../client/model/index.js'
import { Database } from './database.js'

export { DatabaseAdapter, ElectricDatabase }
export type { Database }

export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName = db.name
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || WebSocketWeb

  const client = await baseElectrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    config,
    opts
  )

  return client
}
