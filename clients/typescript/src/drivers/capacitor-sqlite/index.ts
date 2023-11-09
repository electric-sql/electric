// N.b.: importing this module is an entrypoint that imports the Capacitor
// environment dependencies. You can
// use the alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types.js'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index.js'

import { DatabaseAdapter } from './adapter.js'
import { ElectricConfig } from '../../config/index.js'
import { Database } from './database.js'
import { MockSocket } from '../../sockets/mock.js'
import { ElectricClient } from '../../client/model/client.js'
import { DbSchema } from '../../client/model/schema.js'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName: DbName = db.dbname!
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || MockSocket

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
