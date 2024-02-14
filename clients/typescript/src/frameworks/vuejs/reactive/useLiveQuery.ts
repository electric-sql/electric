import {
  watch,
  WatchSource,
  ref,
  Ref,
  computed,
  readonly,
  shallowReadonly,
  DeepReadonly,
  shallowReactive,
  onUnmounted,
} from 'vue'
import {
  LiveResultContext,
  LiveResultUpdate,
} from '../../../client/model/model'
import { hash } from 'ohash'
import { UnsubscribeFunction } from '../../../notifiers'

/**
 * Main reactive query hook for Vue applications. It needs to be
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
  runQueryRef: Ref<LiveResultContext<Res>>
): DeepReadonly<LiveResultUpdate<Res>>

function useLiveQuery<Res>(
  runQueryOrRef: LiveResultContext<Res> | Ref<LiveResultContext<Res>>
): DeepReadonly<LiveResultUpdate<Res>> {
  if (typeof runQueryOrRef === 'function') {
    return useLiveQueryWithQueryHash(runQueryOrRef as LiveResultContext<Res>)
  }

  const runQueryRef = runQueryOrRef as Ref<LiveResultContext<Res>>
  return useLiveQueryWithQueryUpdates(runQueryRef.value, [runQueryRef])
}

function useLiveQueryWithQueryHash<Res>(
  runQuery: LiveResultContext<Res>
): DeepReadonly<LiveResultUpdate<Res>> {
  const queryHash = computed(() => hash(runQuery.sourceQuery))

  return useLiveQueryWithQueryUpdates(runQuery, [queryHash])
}

function useLiveQueryWithQueryUpdates<Res>(
  runQuery: LiveResultContext<Res>,
  runQueryDependencies: WatchSource[]
): DeepReadonly<LiveResultUpdate<Res>> {
  const results = shallowReactive<LiveResultUpdate<Res>>({})
  const unsubscribeRef = ref<UnsubscribeFunction>()

  watch(
    runQueryDependencies,
    () => {
      unsubscribeRef.value?.()
      unsubscribeRef.value = runQuery.subscribe((newResults) => {
        results.results = newResults.results
        results.error = newResults.error
        results.updatedAt = newResults.updatedAt
      })
    },
    { immediate: true }
  )

  onUnmounted(() => unsubscribeRef.value?.())

  return readonly(results)
}

export default useLiveQuery
