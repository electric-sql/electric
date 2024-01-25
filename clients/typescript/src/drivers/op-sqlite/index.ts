import { DbName } from '../../util/types'

import {
  ElectrifyOptions,
  electrify as baseElectrify,
} from '../../electric/index'

import { DatabaseAdapter } from './adapter'
import { ElectricConfig } from '../../config'
import { Database } from './database'
import { setUUIDImpl } from '../../util/common'

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'

// Provide implementation for uuid()
import uuid from 'react-native-uuid'
setUUIDImpl(uuid.v4 as () => string)

import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model/schema'
import { WebSocketReactNative } from '../../sockets/react-native'

export { DatabaseAdapter }
export type { Database }


export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName: DbName = db.dbName!
  const adapter = opts?.adapter || new DatabaseAdapter(db)
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