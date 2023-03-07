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
import { DalNamespace, DbSchemas } from '../../client/model/dalNamespace'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <S extends DbSchemas, T extends Database>(
  db: T,
  dbSchemas: S,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<DalNamespace<S>> => {
  const dbName: DbName = db.name
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || new WebSocketNodeFactory()

  const namespace = await baseElectrify(
    dbName,
    dbSchemas,
    adapter,
    socketFactory,
    config,
    opts
  )

  return namespace
}
