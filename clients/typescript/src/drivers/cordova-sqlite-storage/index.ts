// N.b.: importing this module is an entrypoint that imports the Cordova
// environment dependencies. Specifically `./filesystems/cordova`. You can
// use the alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { DatabaseAdapter } from './adapter'
import { ElectricConfig } from '../../config'
import { Database } from './database'
import { MockSocketFactory } from '../../sockets/mock'
import { DalNamespace, DbSchemas } from '../../client/model/dalNamespace'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <T extends Database, S extends DbSchemas>(
  db: T,
  dbSchemas: S,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<DalNamespace<S>> => {
  const dbName: DbName = db.dbname!
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || new MockSocketFactory()

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
