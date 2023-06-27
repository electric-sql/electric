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
import { Database } from './database'
import { WebSocketReactNativeFactory } from '../../sockets/react-native'

// Provide implementation for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder'

// Provide implementation for global uuid()
import uuid from 'react-native-uuid'
;(function (global: any) {
  global['uuid'] = uuid.v4
})(
  typeof global == '' + void 0
    ? typeof self == '' + void 0
      ? this || {}
      : self
    : global
)

import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model/schema'
import { AuthConfig } from '../../auth/index'

export { DatabaseAdapter }
export type { Database }

export const electrify = async <T extends Database, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  authConfig: AuthConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName: DbName = db._name!
  const adapter = opts?.adapter || new DatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || new WebSocketReactNativeFactory()

  const namespace = await baseElectrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    config,
    authConfig,
    opts
  )

  return namespace
}
