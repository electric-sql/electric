import { AnyElectrifiedDatabase } from '../../drivers'
import { ElectricNamespace } from '../../electric'
import { Row } from '../types'
import Log from 'loglevel'

export type DebugContext = {
  query?: (sql: string) => Promise<Row[]>
  electric?: ElectricNamespace
}

export const setDebugLogLevel = () => {
  Log.setLevel('TRACE')
}

export const init = (
  electrified: AnyElectrifiedDatabase,
  context: DebugContext
) => {
  context.query = (sql: string) => electrified.electric.adapter.query({ sql })
  context.electric = electrified.electric

  setDebugLogLevel()
}
