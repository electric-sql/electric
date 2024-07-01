import { QualifiedTablename } from '../../util/tablename'
import { LiveResultSubscribeFunction } from '../../util/subscribe'

export interface LiveResultContext<T> {
  (): Promise<LiveResult<T>>
  subscribe: LiveResultSubscribeFunction<T>
  sourceQuery?: Record<string, any> | undefined
}

/**
 * A live result wrapping the `result` as well as the concerned table names.
 * The table names are used to subscribe to changes to those tables
 * in order to re-run the live query when one of the tables change.
 */
export class LiveResult<T> {
  constructor(public result: T, public tablenames: QualifiedTablename[]) {}
}

/**
 * A live result update wrapping either the `results` or any `error` from the query,
 * as well as an `updatedAt` timestamp indicating the retrieval time of this result
 */
export interface LiveResultUpdate<T> {
  results?: T
  error?: unknown
  updatedAt?: Date
}
