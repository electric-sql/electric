export interface CommitNotification {
  dbName: string
}

export interface Notifier {
  dbName: string

  notifications?: CommitNotification[]

  notifyCommit(): void
}
