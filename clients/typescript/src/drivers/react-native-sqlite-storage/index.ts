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
import { WebSocketReactNativeFactory } from '../../sockets/react-native'
import { Database } from './database'
import { ElectricClient } from '../../client/model/client'

export type { Database }

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'
// Provide implementation for global uuid()
import uuid from 'react-native-uuid'
import { DbSchema } from '../../client/model/schema'
;(function (global: any) {
  global['uuid'] = uuid.v4
})(
  typeof global == '' + void 0
    ? typeof self == '' + void 0
      ? this || {}
      : self
    : global
)

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
  const socketFactory = opts?.socketFactory || new WebSocketReactNativeFactory()

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
