// This is the namespace that's patched onto the user's database client
// (technically via the proxy machinery) as the `.electric` property.
import { DatabaseAdapter } from './adapter.js'
import { Notifier } from '../notifiers/index.js'
import { ConnectivityState } from '../util/types.js'

export class ElectricNamespace {
  adapter: DatabaseAdapter
  notifier: Notifier
  private _isConnected: boolean
  public get isConnected(): boolean {
    return this._isConnected
  }

  constructor(adapter: DatabaseAdapter, notifier: Notifier) {
    this.adapter = adapter
    this.notifier = notifier
    this._isConnected = false

    // XXX if you're implementing VAX-799, see the note below and maybe refactor
    // this out of here whilst cleaning up the subscription.

    // we need to set isConnected before the first event is emitted,
    // otherwise application might be out of sync with satellite state.
    this.notifier.subscribeToConnectivityStateChanges(
      ({ connectivityState }) => {
        this.setIsConnected(connectivityState)
      }
    )
  }

  // XXX this `isConnected` property is now only used via the ElectricClient.
  // Now ... because the connectivity state change subscription is wired up
  // here, we proxy this property from a dynamic `isConnected` getter on the
  // ElectricClient. All of which is a bit unecessary and something of a
  // code smell. As is the subscription above not being cleaned up.
  setIsConnected(connectivityState: ConnectivityState): void {
    this._isConnected = connectivityState === 'connected'
  }

  // We lift this function a level so the user can call
  // `db.electric.potentiallyChanged()` rather than the longer / more redundant
  // `db.electric.notifier.potentiallyChanged()`.
  potentiallyChanged(): void {
    this.notifier.potentiallyChanged()
  }
}
