import { DatabaseAdapter as DatabaseAdapterI } from '../../electric/adapter'
import { DatabaseAdapter } from './adapter'
import { Database, ElectricDatabase } from './database'
import { ElectricConfig } from '../../config'
import { electrify as baseElectrify, ElectrifyOptions } from '../../electric'
import { WebSocketWeb } from '../../sockets/web'
import { ElectricClient, DbSchema } from '../../client/model'
import { PgBundleMigrator } from '../../migrators/bundle'

export { DatabaseAdapter, ElectricDatabase }
export type { Database }

/**
 * This driver uses `sqlx` and Tauri
 * as a bridge to a Postgres driver written in Rust.
 */
export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName = db.name
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new PgBundleMigrator(adapter, dbDescription.migrations)
  const socketFactory = opts?.socketFactory || WebSocketWeb
  const prepare = async (_connection: DatabaseAdapterI) => {}

  const client = await baseElectrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    config,
    {
      migrator,
      prepare,
      ...opts,
    }
  )

  return client
}
