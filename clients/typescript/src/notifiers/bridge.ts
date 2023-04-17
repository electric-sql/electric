// The `MainThreadBridgeNotifier` and `WorkerBridgeNotifier` are paired
// up across the worker thread client<>server bridge. The main thread
// proxy uses a `MainThreadBridgeNotifier` and the worker thread
// electrified database uses a `WorkerBridgeNotifier`.
//
// They communicate across the bridge using the worker port, via the
// workerClient (main thread) and workerServer (worker thread) instances
// passed into their constructors.

import { NotifyMethod, WorkerClient, WorkerServer } from '../bridge/index'
import { ConnectivityState as ConnectivityState, DbName } from '../util/types'

import {
  Change,
  ChangeCallback,
  ConnectivityStateChangeCallback,
  Notifier,
  PotentialChangeNotification,
} from './index'
import { EventNotifier } from './event'

// Extend the default EventNotifier to:
// - send potentiallyChanged notifications to the worker thread
// - and subscribe to data changes from the worker thread
export class MainThreadBridgeNotifier
  extends EventNotifier
  implements Notifier
{
  workerClient: WorkerClient

  constructor(dbName: DbName, workerClient: WorkerClient) {
    super(dbName)

    this.workerClient = workerClient
  }

  override _emitPotentialChange(dbName: DbName): PotentialChangeNotification {
    const notification = super._emitPotentialChange(dbName)

    // below we use `satisfies` to ensure that the method satisfies NotifyMethod,
    // without assigning the more general `NotifyMethod` type to this constant.
    // This way we keep the type of `method` as precise as possible (thanks to type inference).
    // It is important to keep it precise, because if it would be just `NotifyMethod`
    // then we could call `notify` with a parameter list that matches one of the methods of `EventNotifier`
    // but not necessarily the one we are targeting (i.e. the parameter list for the method that corresponds to `method.name`)
    const method = {
      dbName: dbName,
      name: '_emitPotentialChange',
      target: 'notify',
    } satisfies NotifyMethod

    this.workerClient.notify(method, notification.dbName)

    return notification
  }

  override subscribeToDataChanges(callback: ChangeCallback): string {
    const key = super.subscribeToDataChanges(callback)
    const wrappedCallback = this._changeCallbacks[key] as ChangeCallback

    return this.workerClient.subscribeToChanges(key, wrappedCallback)
  }
  override unsubscribeFromDataChanges(key: string): void {
    super.unsubscribeFromDataChanges(key)

    return this.workerClient.unsubscribeFromChanges(key)
  }

  override _emitConnectivityStatus(dbName: string, status: ConnectivityState) {
    const notification = super._emitConnectivityStatus(dbName, status)
    const method = {
      dbName: dbName,
      name: '_emitConnectivityStatus',
      target: 'notify',
    } satisfies NotifyMethod

    this.workerClient.notify(
      method,
      notification.dbName,
      notification.connectivityState
    )

    return notification
  }

  override subscribeToConnectivityStateChange(
    callback: ConnectivityStateChangeCallback
  ): string {
    const key = super.subscribeToConnectivityStateChange(callback)
    const wrappedCallback = this._connectivityStatusCallbacks[
      key
    ] as ConnectivityStateChangeCallback

    return this.workerClient.subscribeToConnectivityStateChange(
      key,
      wrappedCallback
    )
  }

  override unsubscribeFromConnectivityStateChange(key: string): void {
    super.unsubscribeFromConnectivityStateChange(key)

    return this.workerClient.unsubscribeFromConnectivityStateChange(key)
  }
}

// Extend the default EventNotifier to:
// - send actuallyChanged notifications to the main thread
export class WorkerBridgeNotifier extends EventNotifier implements Notifier {
  workerServer: WorkerServer

  constructor(dbName: DbName, workerServer: WorkerServer) {
    super(dbName)

    this.workerServer = workerServer
  }

  actuallyChanged(dbName: DbName, changes: Change[]): void {
    super.actuallyChanged(dbName, changes)

    this.workerServer._dispatchChangeNotification({
      dbName: dbName,
      changes: changes,
    })
  }

  connectivityStateChange(
    dbName: string,
    connectivityState: ConnectivityState
  ) {
    super.connectivityStateChange(dbName, connectivityState)

    this.workerServer._dispatchConnectivityStateNotification({
      dbName: dbName,
      connectivityState,
    })
  }
}
