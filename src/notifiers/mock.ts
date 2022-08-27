import { DbName } from '../util/types'
import { CommitNotification, Notifier } from './index'

export class MockNotifier implements Notifier {
  dbNames: Set<DbName>
  notifications: CommitNotification[]

  constructor(dbNames: DbName | DbName[]) {
    this.dbNames = new Set(Array.isArray(dbNames) ? dbNames : [dbNames])
    this.notifications = []
  }

  attach(dbName: DbName): void {
    this.dbNames.add(dbName)
  }
  detach(dbName: DbName): void {
    this.dbNames.delete(dbName)
  }

  notifyCommit(): void {
    this.dbNames.forEach((dbName) => {
      const notification: CommitNotification = {dbName: dbName}

      this.notifications.push(notification)
    })
  }
}
