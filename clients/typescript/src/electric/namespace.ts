// This is the namespace that's patched onto the user's database client
// (technically via the proxy machinery) as the `.electric` property.
import { DatabaseAdapter } from './adapter'
import { Notifier } from '../notifiers'

export class ElectricNamespace {
  adapter: DatabaseAdapter
  notifier: Notifier
  isConnected: boolean

  constructor(adapter: DatabaseAdapter, notifier: Notifier) {
    this.adapter = adapter
    this.notifier = notifier
    this.isConnected = false

    // we need to set isConnected before the first event is emitted,
    // otherwise application might be out of sync with satellite state.
    this.notifier.subscribeToConnectivityStateChange((notification) => {
      this.isConnected = notification.connectivityState == 'connected'
    })
  }

  // We lift this function a level so the user can call
  // `db.electric.potentiallyChanged()` rather than the longer / more redundant
  // `db.electric.notifier.potentiallyChanged()`.
  potentiallyChanged(): void {
    this.notifier.potentiallyChanged()
  }
}
