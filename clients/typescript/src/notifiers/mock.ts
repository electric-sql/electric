import { DbName } from '../util/types.js'

import { Notification, Notifier } from './index.js'
import { EventNotifier } from './event.js'

export class MockNotifier extends EventNotifier implements Notifier {
  notifications: Notification[]

  constructor(dbName: DbName) {
    super(dbName)

    this.notifications = []
  }

  _emit(eventName: string, notification: Notification) {
    super._emit(eventName, notification)

    this.notifications.push(notification)
  }
}
