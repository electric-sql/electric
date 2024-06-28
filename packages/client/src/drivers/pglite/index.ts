import { DatabaseAdapter as DatabaseAdapterI } from '@electric-sql/drivers'
import { DatabaseAdapter } from '@electric-sql/drivers/pglite'
import type { Database } from '@electric-sql/drivers/pglite'
import { ElectricConfig } from '../../config'
import { electrify as baseElectrify, ElectrifyOptions } from '../../electric'
import { WebSocketWeb } from '../../sockets/web'
import { ElectricClient, DbSchema } from '../../client/model'
import { PgBundleMigrator } from '../../migrators/bundle'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName = db.dataDir?.split('/').pop() ?? 'memory'
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const migrator =
    opts?.migrator || new PgBundleMigrator(adapter, dbDescription.pgMigrations)
  const socketFactory = opts?.socketFactory || WebSocketWeb
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
