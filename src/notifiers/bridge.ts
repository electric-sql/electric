// The `MainThreadBridgeNotifier` and `WorkerBridgeNotifier` are paired
// up across the worker thread client<>server bridge. The main thread
// proxy uses a `MainThreadBridgeNotifier` and the worker thread
// electrified database uses a `WorkerBridgeNotifier`.
//
// They communicate across the bridge using the worker port, via the
// workerClient (main thread) and workerServer (worker thread) instances
// passed into their constructors.

import { NotifyMethod, WorkerClient, WorkerServer } from '../bridge/index'
import { DbName } from '../util/types'

import { Change, ChangeCallback, Notifier, PotentialChangeNotification } from './index'
import { EventNotifier } from './event'

// Extend the default EventNotifier to:
// - send potentiallyChanged notifications to the worker thread
// - and subscribe to data changes from the worker thread
export class MainThreadBridgeNotifier extends EventNotifier implements Notifier {
  workerClient: WorkerClient

  constructor(dbNames: DbName | DbName[], workerClient: WorkerClient) {
    super(dbNames)

    this.workerClient = workerClient
  }

  _emitPotentialChange(dbName: DbName): PotentialChangeNotification {
    const notification = super._emitPotentialChange(dbName)

    const method: NotifyMethod = {
      dbName: dbName,
      name: '_emitPotentialChange',
      target: 'notify'
    }

    this.workerClient.notify(method, notification)

    return notification
  }

  subscribeToDataChanges(callback: ChangeCallback): string {
    const key = super.subscribeToDataChanges(callback)
    const wrappedCallback = this._changeCallbacks[key]

    return this.workerClient.subscribeToChanges(key, wrappedCallback)
  }
  unsubscribeFromDataChanges(key: string): void {
    super.unsubscribeFromDataChanges(key)

    return this.workerClient.unsubscribeFromChanges(key)
  }
}

// Extend the default EventNotifier to:
// - send actuallyChanged notifications to the main thread
export class WorkerBridgeNotifier extends EventNotifier implements Notifier {
  workerServer: WorkerServer

  constructor(dbNames: DbName | DbName[], workerServer: WorkerServer) {
    super(dbNames)

    this.workerServer = workerServer
  }

  actuallyChanged(dbName: DbName, changes: Change[]): void {
    super.actuallyChanged(dbName, changes)

    this.workerServer._dispatchChangeNotification({
      dbName: dbName,
      changes: changes
    })
  }
}
