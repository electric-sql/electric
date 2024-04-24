import { Row, Statement, ConnectivityState } from 'electric-sql/util'

export type UnsubscribeFunction = () => void

export interface ToolbarInterface {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): ConnectivityState | null
  subscribeToSatelliteStatus(
    name: string,
    callback: (connectivityState: ConnectivityState) => void,
  ): UnsubscribeFunction

  toggleSatelliteStatus(name: string): Promise<void>

  resetDB(dbName: string): Promise<void>
  queryDB(dbName: string, statement: Statement): Promise<Row[]>
}
