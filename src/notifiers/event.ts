import { EventEmitter } from 'events'

import { AuthState } from '../auth/index'
import { randomValue } from '../util/random'
import { QualifiedTablename } from '../util/tablename'
import { ConnectivityState, DbName } from '../util/types'

import {
  AuthStateCallback,
  AuthStateNotification,
  Change,
  ChangeCallback,
  ChangeNotification,
  ConnectivityStateChangeCallback,
  ConnectivityStateChangeNotification,
  Notification,
  NotificationCallback,
  Notifier,
  PotentialChangeCallback,
  PotentialChangeNotification
} from './index'

const EVENT_NAMES = {
  authChange: 'auth:changed',
  actualDataChange: 'data:actually:changed',
  potentialDataChange: 'data:potentially:changed',
  connectivityStateChange: 'network:connectivity:changed'
}

// Global singleton that all event notifiers use by default. Emitting an event
// on this object will notify all subscribers in the same thread. Cross thread
// notifications use the `./bridge` notifiers.
const globalEmitter = new EventEmitter()

export class EventNotifier implements Notifier {
  dbName: DbName

  attachedDbIndex: {
    byAlias: {
      [key: string]: DbName
    },
    byName: {
      [key: DbName]: string
    }
  }

  events: EventEmitter

  _changeCallbacks: {
    [key: string]: NotificationCallback
  }

  _connectivityStatusCallbacks: {
    [key: string]: NotificationCallback
  }

  constructor(dbName: DbName, eventEmitter?: EventEmitter) {
    this.dbName = dbName
    this.attachedDbIndex = {
      byAlias: {},
      byName: {}
    }

    this.events = eventEmitter !== undefined
      ? eventEmitter
      : globalEmitter

    this._changeCallbacks = {}
    this._connectivityStatusCallbacks = {}
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
  subscribeToAuthStateChanges(callback: AuthStateCallback): string {
    const key = randomValue()

    this._changeCallbacks[key] = callback
    this._subscribe(EVENT_NAMES.authChange, callback)

    return key
  }
  unsubscribeFromAuthStateChanges(key: string): void {
    const callback = this._changeCallbacks[key]

    if (callback === undefined) {
      return
    }

    this._unsubscribe(EVENT_NAMES.authChange, callback)

    delete this._changeCallbacks[key]
  }

  potentiallyChanged(): void {
    const dbNames = this._getDbNames()
    const emitPotentialChange = this._emitPotentialChange.bind(this)

    dbNames.forEach(emitPotentialChange)
  }
  actuallyChanged(dbName: DbName, changes: Change[]): void {
    console.log("actually changed notifier")
    if (!this._hasDbName(dbName)) {
      return
    }

    this._emitActualChange(dbName, changes)
  }

  subscribeToPotentialDataChanges(callback: PotentialChangeCallback): string {
    const key = randomValue()
    const thisHasDbName = this._hasDbName.bind(this)

    const wrappedCallback = (notification: PotentialChangeNotification) => {
      if (thisHasDbName(notification.dbName)) {
        callback(notification)
      }
    }

    this._changeCallbacks[key] = wrappedCallback
    this._subscribe(EVENT_NAMES.potentialDataChange, wrappedCallback)

    return key
  }
  unsubscribeFromPotentialDataChanges(key: string): void {
    const callback = this._changeCallbacks[key]

    if (callback === undefined) {
      return
    }

    this._unsubscribe(EVENT_NAMES.potentialDataChange, callback)

    delete this._changeCallbacks[key]
  }

  subscribeToDataChanges(callback: ChangeCallback): string {
    const key = randomValue()
    const thisHasDbName = this._hasDbName.bind(this)

    const wrappedCallback = (notification: ChangeNotification) => {
      if (thisHasDbName(notification.dbName)) {
        callback(notification)
      }
    }

    this._changeCallbacks[key] = wrappedCallback
    this._subscribe(EVENT_NAMES.actualDataChange, wrappedCallback)

    return key
  }
  unsubscribeFromDataChanges(key: string): void {
    const callback = this._changeCallbacks[key]

    if (callback === undefined) {
      return
    }

    this._unsubscribe(EVENT_NAMES.actualDataChange, callback)

    delete this._changeCallbacks[key]
  }

  connectivityStateChange(dbName: string, status: ConnectivityState) {
    if (!this._hasDbName(dbName)) {
      return
    }

    console.log(`emit connectivity status ${status}`)
    this._emitConnectivityStatus(dbName, status)
  }

  subscribeToConnectivityStateChange(callback: ConnectivityStateChangeCallback) {
    const key = randomValue()
    const thisHasDbName = this._hasDbName.bind(this)

    const wrappedCallback = (notification: ConnectivityStateChangeNotification) => {
      if (thisHasDbName(notification.dbName)) {
        callback(notification)
      }
    }

    this._connectivityStatusCallbacks[key] = wrappedCallback
    this._subscribe(EVENT_NAMES.connectivityStateChange, wrappedCallback)

    return key
  }

  unsubscribeFromConnectivityStateChange(key: string): void {
    const callback = this._connectivityStatusCallbacks[key]

    if (callback === undefined) {
      return
    }

    this._unsubscribe(EVENT_NAMES.connectivityStateChange, callback)

    delete this._changeCallbacks[key]
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
      authState: authState
    }

    this._emit(EVENT_NAMES.authChange, notification)

    return notification
  }
  _emitPotentialChange(dbName: DbName): PotentialChangeNotification {
    const notification = {
      dbName: dbName
    }

    this._emit(EVENT_NAMES.potentialDataChange, notification)

    return notification
  }
  _emitActualChange(dbName: DbName, changes: Change[]): ChangeNotification {
    const notification = {
      dbName: dbName,
      changes: changes
    }

    this._emit(EVENT_NAMES.actualDataChange, notification)

    return notification
  }
  _emitConnectivityStatus(dbName: DbName, connectivityState: ConnectivityState): ConnectivityStateChangeNotification {
    const notification = {
      dbName: dbName,
      connectivityState
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
