import { ElectricNamespace } from '../../electric/namespace'
import { Row } from '../types'
import Log, { LogLevelDesc } from 'loglevel'

export type DebugContext = {
  query?: (sql: string) => Promise<Row[]>
  electric?: ElectricNamespace
}

export const setLogLevel = (level: LogLevelDesc = 'TRACE') => {
  Log.setLevel(level)
}

/** True if current running environment is NodeJS */
export const isNode =
  typeof process !== 'undefined' &&
  process.versions !== undefined &&
  process.versions.node !== undefined

/** True if running in NodeJS with debugger attached, but currently always false */
export const isDebuggingNode = false
