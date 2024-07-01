export interface SyncInput<Include, Where> {
  include?: Include
  where?: Where | string
  /** Unique key for a shape subscription, allowing shape modification and unsubscribe */
  key?: string
}
