import {
  watch,
  WatchSource,
  Ref,
  computed,
  readonly,
  DeepReadonly,
  shallowReactive,
  onUnmounted,
  toRefs,
  ToRefs,
  isRef,
  shallowRef,
  unref,
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
 * The provided query will not update reactively, so if you want
 * the query itself to respond to changes make sure to use the
 * form that takes a Ref or live query getter as an argument
 *
 * @param runQuery - a static live query.
 * @param runQueryDependencies - Optional list of dependencies that
 *    will cause the query to rerun
 *
 * @example Using a simple live query. The table will depend on your application
 * ```ts
 * const { results } = useLiveQuery(db.items.liveMany({}))
 * ```
 */
function useLiveQuery<Res>(
  runQuery: LiveResultContext<Res>,
  runQueryDependencies?: WatchSource[]
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>>

/**
 * Main reactive query method for Vue applications. It can be
 * used in tandem with {@link makeElectricDependencyInjector}
 * which injects an {@link ElectricClient} into the component
 * tree in order to be able to form live queries.
 *
 * You can provide a reference to or getter for a live query, and
 * the query results will update with the query reactively.
 *
 * Providing a list of dependencies will cause the query to rerun
 * reactively only based on those dependencies, and not on the
 * query itself.
 *
 * @param runQueryRef - a reference to or getter for a live query
 * @param runQueryDependencies - Optional list of dependencies that
 *    will cause the query to rerun - if provided, the the reactivity
 *    of the query reference itself will not cause it to rerun
 *
 * @example Using a simple live query with a dependency. The table will depend on your application
 * ```ts
 * const limit = ref(5)
 * const { results } = useLiveQuery(() => db.items.liveMany({ take: limit }))
 * ```
 */
function useLiveQuery<Res>(
  runQueryRef: Ref<LiveResultContext<Res>> | (() => LiveResultContext<Res>),
  runQueryDependencies?: WatchSource[]
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>>

function useLiveQuery<Res>(
  runQuery:
    | LiveResultContext<Res>
    | Ref<LiveResultContext<Res>>
    | (() => LiveResultContext<Res>),
  runQueryDependencies?: WatchSource[]
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>> {
  if ('sourceQuery' in runQuery) {
    return useLiveQueryWithRef(shallowRef(runQuery), runQueryDependencies)
  }

  if (isRef(runQuery)) {
    return useLiveQueryWithRef(runQuery, runQueryDependencies)
  }

  return useLiveQueryWithRef(
    computed(runQuery as () => LiveResultContext<Res>),
    runQueryDependencies
  )
}

function useLiveQueryWithRef<Res>(
  runQueryRef: Ref<LiveResultContext<Res>>,
  runQueryDependencies?: WatchSource[]
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>> {
  // if dependencies are specified, only rerun using those
  if (runQueryDependencies) {
    return useLiveQueryWithQueryUpdates(runQueryRef, runQueryDependencies)
  }

  // ensure that we re-subscribe to the query if the hash changes, regardless
  // of how the reference is structured
  const queryHash = computed(() => hash(unref(runQueryRef).sourceQuery))
  return useLiveQueryWithQueryUpdates(runQueryRef, [runQueryRef, queryHash])
}

function useLiveQueryWithQueryUpdates<Res>(
  runQuery: Ref<LiveResultContext<Res>>,
  runQueryDependencies: WatchSource[]
): ToRefs<DeepReadonly<LiveResultUpdate<Res>>> {
  const liveUpdate = shallowReactive<LiveResultUpdate<Res>>({
    results: undefined,
    error: undefined,
    updatedAt: undefined,
  })

  // keep track of subscriptions and unsubscribe from unused ones
  const unsubscribeRef = shallowRef<UnsubscribeFunction>()

  watch(
    runQueryDependencies,
    () => {
      unsubscribeRef.value?.()
      unsubscribeRef.value = unref(runQuery).subscribe((newResults) => {
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
