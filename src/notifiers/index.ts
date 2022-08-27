import { DbName } from '../util/types'

export interface CommitNotification {
  dbName: DbName
}

export interface Notifier {
  dbNames: Set<DbName>

  notifications?: CommitNotification[]

  attach(dbName: DbName): void
  detach(dbName: DbName): void

  notifyCommit(): void
}
