import { DbName } from '../util/types'

import {
  BaseChangeNotifier,
  BaseCommitNotifier,
  ChangeNotification,
  ChangeNotifier,
  ChangedIdentifier,
  CommitNotification,
  CommitNotifier
} from './index'

export class MockChangeNotifier extends BaseChangeNotifier implements ChangeNotifier {
  notifications: ChangeNotification[]

  constructor(dbName: DbName) {
    super(dbName)

    this.notifications = []
  }

  notifyChange(changes: ChangedIdentifier[]): void {
    const notification: ChangeNotification = {
      dbName: this.dbName,
      changes: changes
    }

    this.notifications.push(notification)
  }
}

export class MockCommitNotifier extends BaseCommitNotifier implements CommitNotifier {
  notifications: CommitNotification[]

  constructor(dbNames: DbName | DbName[]) {
    super(dbNames)

    this.notifications = []
  }

  notifyCommit(): void {
    this.dbNames.forEach((dbName) => {
      const notification: CommitNotification = {
        dbName: dbName
      }

      this.notifications.push(notification)
    })
  }
}
