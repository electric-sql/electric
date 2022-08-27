import { EventEmitter } from 'events'
import { DbName } from '../util/types'
import { CommitNotification, Notifier } from './index'

// XXX maybe we can factor out the event emitter and thus
// dry up the emit and mock notifiers -- let's see how
// the satellite integratioon goes first.
export class EmitNotifier extends EventEmitter implements Notifier {
  dbNames: Set<DbName>

  constructor(dbNames: DbName | DbName[]) {
    super()

    this.dbNames = new Set(Array.isArray(dbNames) ? dbNames : [dbNames])
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

      this.emit('commit', notification)
    })
  }
}
