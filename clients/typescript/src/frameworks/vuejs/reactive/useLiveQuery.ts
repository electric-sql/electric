import {
  watch,
  WatchSource,
  ref,
  Ref,
  computed,
  readonly,
  DeepReadonly,
  shallowReactive,
  onUnmounted,
  toRefs,
  ToRefs,
} from 'vue'
import {
  LiveResultContext,
  LiveResultUpdate,
} from '../../../client/model/model'
import { hash } from 'ohash'
import { UnsubscribeFunction } from '../../../notifiers'

/**
 * Main reactive query method for Vue applications. It can be
 * used in tandem with {@link makeElectricDependencyInjector}
 * which injects an {@link ElectricClient} into the component
 * tree in order to be able to form live queries.
 *
 * Live query provided can be dynamic, but it will be a hash of
 * the provided query will be computed on every render.
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
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>>

/**
 * Main reactive query method for Vue applications. It can be
 * used in tandem with {@link makeElectricDependencyInjector}
 * which injects an {@link ElectricClient} into the component
 * tree in order to be able to form live queries.
 *
 * You can provide a reference to a live query, and the reactivity
 * provided by the reference to the query will be carried forward
 * to the results, ensuring that changes to the query are reflected
 *
 * @param runQueryRef - a reference to a live query
 *
 * @example Using a simple live query with a dependency. The table will depend on your application
 * ```ts
 * const limit = ref(5)
 * const { results } = useLiveQuery(computed(() => db.items.liveMany({ take: limit })))
 * ```
 */
function useLiveQuery<Res>(
  runQueryRef: Ref<LiveResultContext<Res>>
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>>

function useLiveQuery<Res>(
  runQueryOrRef: LiveResultContext<Res> | Ref<LiveResultContext<Res>>
) {
  if (typeof runQueryOrRef === 'function') {
    return useLiveQueryWithQueryHash(runQueryOrRef as LiveResultContext<Res>)
  }

  const runQueryRef = runQueryOrRef as Ref<LiveResultContext<Res>>
  return useLiveQueryWithQueryUpdates(runQueryRef.value, [runQueryRef])
}

function useLiveQueryWithQueryHash<Res>(runQuery: LiveResultContext<Res>) {
  const queryHash = computed(() => hash(runQuery.sourceQuery))

  return useLiveQueryWithQueryUpdates(runQuery, [queryHash])
}

function useLiveQueryWithQueryUpdates<Res>(
  runQuery: LiveResultContext<Res>,
  runQueryDependencies: WatchSource[]
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>> {
  const liveUpdate = shallowReactive<LiveResultUpdate<Res>>({
    results: undefined,
    error: undefined,
    updatedAt: undefined,
  })

  const unsubscribeRef = ref<UnsubscribeFunction>()

  watch(
    runQueryDependencies,
    () => {
      unsubscribeRef.value?.()
      unsubscribeRef.value = runQuery.subscribe((newResults) => {
        liveUpdate.results = newResults.results
        liveUpdate.error = newResults.error
        liveUpdate.updatedAt = newResults.updatedAt
      })
    },
    { immediate: true }
  )

  onUnmounted(() => unsubscribeRef.value?.())

  return toRefs(readonly(liveUpdate))
}

export default useLiveQuery
