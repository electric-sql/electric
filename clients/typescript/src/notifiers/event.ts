import { EventEmitter } from 'events'

import { AuthState } from '../auth/index'
import { QualifiedTablename } from '../util/tablename'
import { ConnectivityState, DbName } from '../util/types'
import Log from 'loglevel'

import {
  AuthStateCallback,
  AuthStateNotification,
  Change,
  ChangeCallback,
  ChangeNotification,
  ChangeOrigin,
  ConnectivityStateChangeCallback,
  ConnectivityStateChangeNotification,
  Notification,
  NotificationCallback,
  Notifier,
  PotentialChangeCallback,
  PotentialChangeNotification,
  UnsubscribeFunction,
} from './index'

export const EVENT_NAMES = {
  authChange: 'auth:changed',
  actualDataChange: 'data:actually:changed',
  potentialDataChange: 'data:potentially:changed',
  connectivityStateChange: 'network:connectivity:changed',
}

// Global singleton that all event notifiers use by default. Emitting an event
// on this object will notify all subscribers in the same thread. Cross thread
// notifications use the `./bridge` notifiers.
const globalEmitter = new EventEmitter()

// Increase the maximum number of listeners because multiple components
// use this same emitter instance.
globalEmitter.setMaxListeners(250)

export class EventNotifier implements Notifier {
  dbName: DbName

  attachedDbIndex: {
    byAlias: {
      [key: string]: DbName
    }
    byName: {
      [key: DbName]: string
    }
  }

  events: EventEmitter

  constructor(dbName: DbName, eventEmitter?: EventEmitter) {
    this.dbName = dbName
    this.attachedDbIndex = {
      byAlias: {},
      byName: {},
    }

    this.events = eventEmitter !== undefined ? eventEmitter : globalEmitter
  }

  attach(dbName: DbName, dbAlias: string): void {
    const idx = this.attachedDbIndex

    idx.byAlias[dbAlias] = dbName
    idx.byName[dbName] = dbAlias
  }

  detach(dbAlias: string): void {
    const idx = this.attachedDbIndex

    if (dbAlias in idx.byAlias) {
      const dbName = idx.byAlias[dbAlias]

      delete idx.byAlias[dbAlias]
      delete idx.byName[dbName]
    }
  }

  alias({ dbName, changes }: ChangeNotification): QualifiedTablename[] {
    const idx = this.attachedDbIndex
    const primaryDbName = this.dbName

    return changes
      .map(({ qualifiedTablename }): QualifiedTablename | void => {
        if (dbName === primaryDbName) {
          return qualifiedTablename
        }

        const dbAlias = idx.byName[dbName]
        if (dbAlias !== undefined) {
          qualifiedTablename.namespace = dbAlias

          return qualifiedTablename
        }
      })
      .filter((value) => value !== undefined) as QualifiedTablename[]
  }

  authStateChanged(authState: AuthState): void {
    this._emitAuthStateChange(authState)
  }
  subscribeToAuthStateChanges(
    callback: AuthStateCallback
  ): UnsubscribeFunction {
    this._subscribe(EVENT_NAMES.authChange, callback)
    return () => {
      this._unsubscribe(EVENT_NAMES.authChange, callback)
    }
  }

  potentiallyChanged(): void {
    const dbNames = this._getDbNames()
    const emitPotentialChange = this._emitPotentialChange.bind(this)

    dbNames.forEach(emitPotentialChange)
  }
  actuallyChanged(
    dbName: DbName,
    changes: Change[],
    origin: ChangeOrigin
  ): void {
    Log.info('actually changed notifier')
    if (!this._hasDbName(dbName)) {
      return
    }

    this._emitActualChange(dbName, changes, origin)
  }

  subscribeToPotentialDataChanges(
    callback: PotentialChangeCallback
  ): UnsubscribeFunction {
    const thisHasDbName = this._hasDbName.bind(this)

    const wrappedCallback = (notification: PotentialChangeNotification) => {
      if (thisHasDbName(notification.dbName)) {
        callback(notification)
      }
    }

    this._subscribe(EVENT_NAMES.potentialDataChange, wrappedCallback)

    return () => {
      this._unsubscribe(EVENT_NAMES.potentialDataChange, wrappedCallback)
    }
  }

  subscribeToDataChanges(callback: ChangeCallback): UnsubscribeFunction {
    const thisHasDbName = this._hasDbName.bind(this)

    const wrappedCallback = (notification: ChangeNotification) => {
      if (thisHasDbName(notification.dbName)) {
        callback(notification)
      }
    }

    this._subscribe(EVENT_NAMES.actualDataChange, wrappedCallback)

    return () => {
      this._unsubscribe(EVENT_NAMES.actualDataChange, wrappedCallback)
    }
  }

  connectivityStateChanged(dbName: string, status: ConnectivityState) {
    if (!this._hasDbName(dbName)) {
      return
    }

    this._emitConnectivityStatus(dbName, status)
  }

  subscribeToConnectivityStateChanges(
    callback: ConnectivityStateChangeCallback
  ): UnsubscribeFunction {
    const thisHasDbName = this._hasDbName.bind(this)

    const wrappedCallback = (
      notification: ConnectivityStateChangeNotification
    ) => {
      if (thisHasDbName(notification.dbName)) {
        callback(notification)
      }
    }

    this._subscribe(EVENT_NAMES.connectivityStateChange, wrappedCallback)

    return () => {
      this._unsubscribe(EVENT_NAMES.connectivityStateChange, wrappedCallback)
    }
  }

  _getDbNames(): DbName[] {
    const idx = this.attachedDbIndex

    return [this.dbName, ...Object.keys(idx.byName)]
  }
  _hasDbName(dbName: DbName): boolean {
    const idx = this.attachedDbIndex

    return dbName === this.dbName || dbName in idx.byName
  }

  // Extracting out these methods allows them to be overridden
  // without duplicating any dbName filter / check logic, etc.
  _emitAuthStateChange(authState: AuthState): AuthStateNotification {
    const notification = {
      authState: authState,
    }

    this._emit(EVENT_NAMES.authChange, notification)

    return notification
  }
  _emitPotentialChange(dbName: DbName): PotentialChangeNotification {
    const notification = {
      dbName: dbName,
    }

    this._emit(EVENT_NAMES.potentialDataChange, notification)

    return notification
  }
  _emitActualChange(
    dbName: DbName,
    changes: Change[],
    origin: ChangeOrigin
  ): ChangeNotification {
    const notification = {
      dbName: dbName,
      changes: changes,
      origin: origin,
    }

    this._emit(EVENT_NAMES.actualDataChange, notification)

    return notification
  }
  _emitConnectivityStatus(
    dbName: DbName,
    connectivityState: ConnectivityState
  ): ConnectivityStateChangeNotification {
    const notification = {
      dbName: dbName,
      connectivityState,
    }

    this._emit(EVENT_NAMES.connectivityStateChange, notification)

    return notification
  }

  _emit(eventName: string, notification: Notification) {
    this.events.emit(eventName, notification)
  }
  _subscribe(eventName: string, callback: NotificationCallback): void {
    this.events.addListener(eventName, callback)
  }
  _unsubscribe(eventName: string, callback: NotificationCallback): void {
    this.events.removeListener(eventName, callback)
  }
}
