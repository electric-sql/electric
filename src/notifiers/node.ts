
import { EventEmitter } from 'events'
import { CommitNotification, Notifier } from './index'

export class EmitNotifier extends EventEmitter implements Notifier {
  dbName: string

  constructor(dbName: string) {
    super()

    this.dbName = dbName
  }

  notifyCommit(): void {
    const notification: CommitNotification = {dbName: this.dbName}

    this.emit('commit', notification)
  }
}
