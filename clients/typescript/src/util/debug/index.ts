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

/*
export const init = (
  electrified: AnyElectrifiedDatabase,
  context: DebugContext
) => {
  context.query = (sql: string) => electrified.electric.adapter.query({ sql })
  context.electric = electrified.electric

  setLogLevel('TRACE')
}
 */
