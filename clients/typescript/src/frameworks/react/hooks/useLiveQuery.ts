import {
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  DependencyList,
} from 'react'
import { hash } from 'ohash'

import { ChangeNotification } from '../../../notifiers/index'
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
 * @param dependencies - a list of React depenencies that causes the function returning the live query to rerun
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
  const [currentQueryHash, setQueryHash] = useState(() =>
    hash(runQuery.sourceQuery)
  )

  // Keep track of the hash of the source query to be able to rebuild everything
  useEffect(() => {
    const newQueryHash = hash(runQuery.sourceQuery)
    if (newQueryHash !== currentQueryHash) {
      setQueryHash(newQueryHash)
    }
  }, [runQuery.sourceQuery])

  return useLiveQueryWithQueryUpdates(runQuery, [currentQueryHash])
}

function useLiveQueryWithQueryUpdates<Res>(
  runQuery: LiveResultContext<Res>,
  runQueryDependencies: DependencyList
): ResultData<Res> {
  const electric = useContext(ElectricContext)

  const [changeSubscriptionKey, setChangeSubscriptionKey] = useState<string>()
  const [tablenames, setTablenames] = useState<QualifiedTablename[]>()
  const [tablenamesKey, setTablenamesKey] = useState<string>()
  const [resultData, setResultData] = useState<ResultData<Res>>({})

  // The effect below is run only after the initial render
  // because of the empty array of dependencies
  useEffect(() => {
    let ignore = false

    // Do an initial run of the query to fetch the table names
    const runInitialQuery = async () => {
      try {
        const res = await runQuery()
        const tablenamesKey = JSON.stringify(res.tablenames)

        if (!ignore) setTablenames(res.tablenames)
        if (!ignore) setTablenamesKey(tablenamesKey)
        if (!ignore) setResultData(successResult(res.result))
      } catch (err) {
        if (!ignore) setResultData(errorResult(err))
      }
    }

    runInitialQuery()

    return () => {
      ignore = true
    }
  }, runQueryDependencies)

  // Store the `runQuery` function as a callback
  const runLiveQuery = useCallback(async () => {
    try {
      const res = await runQuery()
      setResultData(successResult(res.result))
    } catch (err) {
      setResultData(errorResult(err))
    }
  }, runQueryDependencies)

  // Once we have electric, we then establish the data change
  // notification subscription, comparing the tablenames used by the
  // query with the changed tablenames in the data change notification
  // to determine whether to re-query or not.
  //
  // If we do need to re-query, then we use the saved function to reuse the query
  useEffect(() => {
    if (
      electric === undefined ||
      tablenamesKey === undefined ||
      tablenames === undefined
    ) {
      return
    }

    let ignore = false
    const notifier = electric.notifier
    const handleChange = (notification: ChangeNotification): void => {
      // Reduces the `ChangeNotification` to an array of namespaced tablenames,
      // in a way that supports both the main namespace for the primary database
      // and aliases for any attached databases.
      const changedTablenames = notifier.alias(notification)

      if (hasIntersection(tablenames, changedTablenames)) {
        if (!ignore) runLiveQuery()
      }
    }

    const key = notifier.subscribeToDataChanges(handleChange)
    if (changeSubscriptionKey !== undefined) {
      notifier.unsubscribeFromDataChanges(changeSubscriptionKey)
    }

    setChangeSubscriptionKey(key)

    return () => {
      ignore = true
      notifier.unsubscribeFromDataChanges(key)
    }
  }, [electric, tablenamesKey, tablenames, runLiveQuery])

  return resultData
}

export default useLiveQuery
