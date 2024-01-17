import {
  useContext,
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  DependencyList,
} from 'react'
import { hash } from 'ohash'

import { ChangeNotification, Notifier } from '../../../notifiers/index'
import { QualifiedTablename, hasIntersection } from '../../../util/tablename'

import { ElectricContext } from '../provider'
import { LiveResultContext } from '../../../client/model/model'

export interface ResultData<T> {
  error?: unknown
  results?: T
  updatedAt?: Date
}

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

/**
 * Main reactive query hook for React applications. It needs to be
 * used in tandem with the {@link ElectricProvider} which sets an
 * {@link ElectricClient) as the `electric` value. This provides
 * a notifier which this hook uses to subscribe to data change
 * notifications to matching tables. The {@link ElectricProvider}
 * can be obtained through {@link makeElectricContext}.
 *
 * Live query provided can be dynamic, but it will be a hash of the provided query will be computed on every render.
 * If you need a more optimal approach, use a two-argument version of this with explicit dependency listing
 *
 * @param runQuery - a live query.
 *
 * @example Using a simple live query. The table will depend on your application
 * ```ts
 * const { results } = useLiveQuery(db.items.liveMany({}))
 * ```
 */
function useLiveQuery<Res>(runQuery: LiveResultContext<Res>): ResultData<Res>

/**
 * Main reactive query hook for React applications. It needs to be
 * used in tandem with the {@link ElectricProvider} which sets an
 * {@link ElectricClient) as the `electric` value. This provides
 * a notifier which this hook uses to subscribe to data change
 * notifications to matching tables. The {@link ElectricProvider}
 * can be obtained through {@link makeElectricContext}.
 *
 * You can think of arguments to this functions as arguments to `useMemo`.
 * The function should return a live query, and the dependency list is passed
 * to `useMemo` to rerun the function.
 *
 * @param runQueryFn - a function that returns a live query
 * @param dependencies - a list of React dependencies that causes the function returning the live query to rerun
 *
 * @example Using a simple live query with a dependency. The table will depend on your application
 * ```ts
 * const [limit, _setLimit] = useState(10)
 * const { results } = useLiveQuery(() => db.items.liveMany({ take: limit }), [limit])
 * ```
 */
function useLiveQuery<Res>(
  runQueryFn: () => LiveResultContext<Res>,
  dependencies: DependencyList
): ResultData<Res>
function useLiveQuery<Res>(
  runQueryOrFn: LiveResultContext<Res> | (() => LiveResultContext<Res>),
  deps?: DependencyList
): ResultData<Res> {
  if (deps) {
    return useLiveQueryWithDependencies(
      runQueryOrFn as () => LiveResultContext<Res>,
      deps
    )
  } else {
    return useLiveQueryWithQueryHash(runQueryOrFn as LiveResultContext<Res>)
  }
}

function useLiveQueryWithDependencies<Res>(
  runQueryFn: () => LiveResultContext<Res>,
  dependencies: DependencyList
): ResultData<Res> {
  const runQuery = useMemo(runQueryFn, dependencies)

  return useLiveQueryWithQueryUpdates(runQuery, [runQuery])
}

function useLiveQueryWithQueryHash<Res>(
  runQuery: LiveResultContext<Res>
): ResultData<Res> {
  const queryHash = useMemo(
    () => hash(runQuery.sourceQuery),
    [runQuery.sourceQuery]
  )

  return useLiveQueryWithQueryUpdates(runQuery, [queryHash])
}

function useLiveQueryWithQueryUpdates<Res>(
  runQuery: LiveResultContext<Res>,
  runQueryDependencies: DependencyList
): ResultData<Res> {
  const electric = useContext(ElectricContext)

  const tablenames = useRef<QualifiedTablename[]>([])
  const [resultData, setResultData] = useState<ResultData<Res>>({})

  // Store the `runQuery` function as a callback, optionally
  // provide way to prevent state updates for handling dangling
  // async calls
  const runLiveQuery = useCallback(
    ({
      shouldUpdateState = () => true,
    }: {
      shouldUpdateState?: () => boolean
    }) => {
      runQuery()
        .then((res) => {
          if (!shouldUpdateState()) return
          tablenames.current = res.tablenames
          setResultData(successResult(res.result))
        })
        .catch((err) => {
          if (!shouldUpdateState()) return
          setResultData(errorResult(err))
        })
    },
    runQueryDependencies
  )

  // Runs initial query, storing affected tablenames, and subscribes to
  // any subsequent changes to the affected tables for rerunning the query
  const subscribeToDataChanges = useCallback(
    (notifier: Notifier) => {
      let cancelled = false
      const shouldUpdateState = () => !cancelled

      const handleChange = (notification: ChangeNotification): void => {
        // Reduces the `ChangeNotification` to an array of namespaced tablenames,
        // in a way that supports both the main namespace for the primary database
        // and aliases for any attached databases.
        const changedTablenames = notifier.alias(notification)
        if (hasIntersection(tablenames.current, changedTablenames)) {
          runLiveQuery({ shouldUpdateState })
        }
      }

      tablenames.current = []
      runLiveQuery({ shouldUpdateState })
      const unsubscribe = notifier?.subscribeToDataChanges(handleChange)
      return () => {
        cancelled = true
        unsubscribe?.()
      }
    },
    [runLiveQuery]
  )

  // Once we have electric, we then run the query and establish the data
  // change notification subscription, comparing the tablenames used by the
  // query with the changed tablenames in the data change notification
  // to determine whether to re-query or not.
  //
  // If we do need to re-query, then we use the saved function to reuse the query
  useEffect(() => {
    if (electric?.notifier == undefined) return
    const unsubscribe = subscribeToDataChanges(electric?.notifier)
    return unsubscribe
  }, [electric?.notifier, subscribeToDataChanges])

  return resultData
}

export default useLiveQuery
