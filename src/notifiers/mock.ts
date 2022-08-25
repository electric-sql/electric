
import { CommitNotification, Notifier } from './index'

export class MockNotifier implements Notifier {
  dbName: string
  notifications: CommitNotification[]

  constructor(dbName: string) {
    this.dbName = dbName
    this.notifications = []
  }

  notifyCommit(): void {
    this.notifications.push({dbName: this.dbName})
  }
}
