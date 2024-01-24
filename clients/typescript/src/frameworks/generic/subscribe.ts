import { QualifiedTablename, hasIntersection } from '../../util'
import { ChangeNotification, Notifier } from '../../notifiers'
import { LiveResultContext } from '../../client/model/model'

export interface ResultData<T> {
  error?: unknown
  results?: T
  updatedAt?: Date
}

interface QueryResult<T> {
  result: ResultData<T>
  tablenames?: QualifiedTablename[]
}

type UnsubscribeFn = () => void

function successResult<T>(results: T): ResultData<T> {
  return {
    error: undefined,
    results: results,
    updatedAt: new Date(),
  }
}

function errorResult<T>(error: unknown): ResultData<T> {
  return {
    error: error,
    results: undefined,
    updatedAt: new Date(),
  }
}

async function executeQuery<Res>(
  runQuery: LiveResultContext<Res>
): Promise<QueryResult<Res>> {
  try {
    const res = await runQuery()
    return {
      result: successResult(res.result),
      tablenames: res.tablenames,
    }
  } catch (err) {
    return {
      result: errorResult(err),
      tablenames: undefined,
    }
  }
}

/**
 * Subscribes to the results of [runQuery] using the [notifier], and calls
 * [onResultUpdate] with the query's result as soon as the subscription is
 * created and on any subsequent updates to the tables relevant to the query
 * 
 * @returns A function to unsubsribe from the query results.
 */
export function subscribeToQueryResults<Res>({
  notifier,
  runQuery,
  onResultUpdate,
}: {
  notifier: Notifier
  runQuery: LiveResultContext<Res>
  onResultUpdate: (result: ResultData<Res>) => void
}) : UnsubscribeFn {
  let cancelled = false
  let relevantTablenames: QualifiedTablename[] | undefined

  // utility to conditionally update the results and affected tablenames
  // if change subscription is still active
  const updateState = ({ result, tablenames }: QueryResult<Res>) => {
    if (cancelled) return
    relevantTablenames = tablenames
    onResultUpdate(result)
  }

  const handleChange = (notification: ChangeNotification): void => {
    // Reduces the `ChangeNotification` to an array of namespaced tablenames,
    // in a way that supports both the main namespace for the primary database
    // and aliases for any attached databases.
    const changedTablenames = notifier.alias(notification)
    if (
      relevantTablenames &&
      hasIntersection(relevantTablenames, changedTablenames)
    ) {
      executeQuery<Res>(runQuery).then(updateState)
    }
  }

  // run initial query to populate results and affected tablenames
  executeQuery<Res>(runQuery).then(updateState)
  const unsubscribe = notifier?.subscribeToDataChanges(handleChange)

  return () => {
    cancelled = true
    unsubscribe?.()
  }
}