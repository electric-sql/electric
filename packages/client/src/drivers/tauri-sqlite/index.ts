import {
  DatabaseAdapter,
  createDatabase,
} from '@electric-sql/drivers/tauri-sqlite'
import type { Database } from '@electric-sql/drivers/tauri-sqlite'
import { ElectricConfig } from '../../config'
import { electrify as baseElectrify, ElectrifyOptions } from '../../electric'
import { WebSocketWeb } from '../../sockets/web'
import { ElectricClient, DbSchema } from '../../client/model'

export { DatabaseAdapter, createDatabase }
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
