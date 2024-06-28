import { DbName } from '../util/types'

import { Notification, Notifier } from './index'
import { EventNotifier } from './event'
import EventEmitter from 'events'

export class MockNotifier extends EventNotifier implements Notifier {
  notifications: Notification[]

  constructor(dbName: DbName, emitter?: EventEmitter) {
    super(dbName, emitter)

    this.notifications = []
  }

  _emit(eventName: string, notification: Notification) {
    super._emit(eventName, notification)

    this.notifications.push(notification)
  }
}
