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
  process.versions != null &&
  process.versions.node != null

/** True if running in NodeJS with debugger attached */
export let isDebuggingNode = false

if (isNode) {
  try {
    const { default: inspector } = await import('node:inspector')

    isDebuggingNode = inspector.url() !== undefined
  } catch {} // eslint-disable-line no-empty
}
