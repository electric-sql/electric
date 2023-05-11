// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.

import { ElectricConfig } from '../../config/index'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { WebSocketNodeFactory } from '../../sockets/node'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { Database } from './database'
import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model/schema'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <DB extends DbSchema<any>, T extends Database>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName: DbName = db.name
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || new WebSocketNodeFactory()

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
