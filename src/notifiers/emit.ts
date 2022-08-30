import { EventEmitter } from 'events'

import {
  BaseChangeNotifier,
  BaseCommitNotifier,
  ChangeNotification,
  ChangeNotifier,
  ChangedIdentifier,
  CommitNotification,
  CommitNotifier
} from './index'

// The events that we emit and listen in.
export const EVENT_NAMES = {
  changed: 'electric:db:changed',
  commited: 'electric:db:commited'
}

// Global singleton that we use for all emitted events.
export const globalEmitter = new EventEmitter()

// Notifier that emits "this data has changed" notifications.
export class EmitChangeNotifier extends BaseChangeNotifier implements ChangeNotifier {
  notifyChange(changes: ChangedIdentifier[]): void {
    const notification: ChangeNotification = {
      dbName: this.dbName,
      changes: changes
    }

    globalEmitter.emit(EVENT_NAMES.changed, notification)
  }
}

// Notifier that emits "this db has commited" notifications.
export class EmitCommitNotifier extends BaseCommitNotifier implements CommitNotifier {
  notifyCommit(): void {
    this.dbNames.forEach((dbName) => {
      const notification: CommitNotification = {dbName: dbName}

      globalEmitter.emit(EVENT_NAMES.commited, notification)
    })
  }
}
