// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.

import { ElectricConfig } from '../../config/index.js'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index.js'

import { DbName } from '../../util/types.js'

import { DatabaseAdapter } from './adapter.js'
import { Database } from './database.js'
import { ElectricClient } from '../../client/model/client.js'
import { DbSchema } from '../../client/model/schema.js'
import { WebSocketNode } from '../../sockets/node.js'

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
  const socketFactory = opts?.socketFactory || WebSocketNode

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
