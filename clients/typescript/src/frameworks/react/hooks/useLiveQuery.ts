import { useContext, useEffect, useState, useMemo, DependencyList } from 'react'
import { hash } from 'ohash'

import { ElectricContext } from '../provider'
import {
  LiveResultContext,
  LiveResultUpdate,
} from '../../../client/model/model'

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
function useLiveQuery<Res>(
  runQuery: LiveResultContext<Res>
): LiveResultUpdate<Res>

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
): LiveResultUpdate<Res>
function useLiveQuery<Res>(
  runQueryOrFn: LiveResultContext<Res> | (() => LiveResultContext<Res>),
  deps?: DependencyList
): LiveResultUpdate<Res> {
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
): LiveResultUpdate<Res> {
  const runQuery = useMemo(runQueryFn, dependencies)

  return useLiveQueryWithQueryUpdates(runQuery, [runQuery])
}

function useLiveQueryWithQueryHash<Res>(
  runQuery: LiveResultContext<Res>
): LiveResultUpdate<Res> {
  const queryHash = useMemo(
    () => hash(runQuery.sourceQuery),
    [runQuery.sourceQuery]
  )

  return useLiveQueryWithQueryUpdates(runQuery, [queryHash])
}

function useLiveQueryWithQueryUpdates<Res>(
  runQuery: LiveResultContext<Res>,
  runQueryDependencies: DependencyList
): LiveResultUpdate<Res> {
  const electric = useContext(ElectricContext)
  const [resultData, setResultData] = useState<LiveResultUpdate<Res>>({})

  // Once we have electric, we subscribe to the query results and
  // update that subscription on any dependency change
  useEffect(() => {
    if (electric?.notifier === undefined) return
    const unsubscribe = runQuery.subscribe(setResultData)
    return unsubscribe
  }, [electric?.notifier, ...runQueryDependencies])

  return resultData
}

export default useLiveQuery
