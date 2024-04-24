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

  getSatelliteShapeSubscriptions(name: string): string[]

  resetDb(dbName: string): Promise<void>
  queryDb(dbName: string, statement: Statement): Promise<Row[]>
}
