// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types.js'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index.js'

import { DatabaseAdapter } from './adapter.js'
import { ElectricConfig } from '../../config/index.js'
import { WebSocketReactNative } from '../../sockets/react-native.js'
import { Database } from './database.js'
import { ElectricClient } from '../../client/model/client.js'
import { DbSchema } from '../../client/model/schema.js'

export type { Database }

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'

export { DatabaseAdapter }

export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  promisesEnabled: boolean,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName: DbName = db.dbName
  const adapter = opts?.adapter || new DatabaseAdapter(db, promisesEnabled)
  const socketFactory = opts?.socketFactory || WebSocketReactNative

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
