// N.b.: importing this module is an entrypoint that imports the React Native
// environment dependencies. Specifically `react-native-fs`. You can use the
// alternative entrypoint in `./test` to avoid importing this.
import { DbName } from '../../util/types'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { DatabaseAdapter } from './adapter'
import { ElectricConfig } from '../../config'
import { WebSocketReactNative } from '../../sockets/react-native'
import { Database } from './database'
import { ElectricClient } from '../../client/model/client'
import { setUUIDImpl } from '../../util/common'

export type { Database }

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'

// Provide implementation for uuid()
import uuid from 'react-native-uuid'
setUUIDImpl(uuid.v4 as () => string)

import { DbSchema } from '../../client/model/schema'
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
