// This is the namespace that's patched onto the user's database client
// (technically via the proxy machinery) as the `.electric` property.
import { DatabaseAdapter } from './adapter'
import { Notifier, UnsubscribeFunction } from '../notifiers'
import { ConnectivityState } from '../util/types'
import { GlobalRegistry, Registry } from '../satellite'

export class ElectricNamespace {
  dbName: string
  adapter: DatabaseAdapter
  notifier: Notifier
  public readonly registry: Registry | GlobalRegistry
  private _isConnected: boolean
  public get isConnected(): boolean {
    return this._isConnected
  }

  private _unsubscribeStateChanges: UnsubscribeFunction

  constructor(
    dbName: string,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    registry: Registry | GlobalRegistry
  ) {
    this.dbName = dbName
    this.adapter = adapter
    this.notifier = notifier
    this.registry = registry
    this._isConnected = false

    this._unsubscribeStateChanges =
      this.notifier.subscribeToConnectivityStateChanges(
        ({ connectivityState }) => {
          this.setIsConnected(connectivityState)
        }
      )
  }

  setIsConnected(connectivityState: ConnectivityState): void {
    this._isConnected = connectivityState === 'connected'
  }

  // We lift this function a level so the user can call
  // `db.electric.potentiallyChanged()` rather than the longer / more redundant
  // `db.electric.notifier.potentiallyChanged()`.
  potentiallyChanged(): void {
    this.notifier.potentiallyChanged()
  }

  /**
   * Cleans up the resources used by the `ElectricNamespace`.
   */
  async close(): Promise<void> {
    this._unsubscribeStateChanges()
    await this.registry.stop(this.dbName)
  }
}
