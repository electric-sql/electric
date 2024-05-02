import { DatabaseAdapter as DatabaseAdapterI } from '../../electric/adapter'
import { DatabaseAdapter } from './adapter'
import { Database, createEmbeddedPostgres } from './database'
import { ElectricConfig } from '../../config'
import { electrify as baseElectrify, ElectrifyOptions } from '../../electric'
import { WebSocketNode } from '../../sockets/node'
import { ElectricClient, DbSchema } from '../../client/model'
import { PgBundleMigrator } from '../../migrators/bundle'

export { DatabaseAdapter, createEmbeddedPostgres }
export type { Database }

/**
 * This embdedded-postgres driver is used for unit testing.
 * The real driver to run Postgres is the `sqlx` driver
 * which uses Tauri as a bridge to a Postgres driver written in Rust.
 */
export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName = `${db.host}:${db.port}/${db.database ?? ''}`
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new PgBundleMigrator(adapter, dbDescription.pgMigrations)
  const socketFactory = opts?.socketFactory || WebSocketNode
  const prepare = async (_connection: DatabaseAdapterI) => undefined

  const configWithDialect = {
    ...config,
    dialect: 'Postgres',
  } as const

  const client = await baseElectrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    configWithDialect,
    {
      migrator,
      prepare,
      ...opts,
    }
  )

  return client
}
