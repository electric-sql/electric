import { useContext, useEffect, useState } from 'react'

import { ChangeNotification } from '../../../notifiers/index'
import { QualifiedTablename, hasIntersection } from '../../../util/tablename'
import { AnyFunction } from '../../../util/types'

import { ElectricContext } from '../provider'
import useRandom from './useRandom'

export interface ResultData<T> {
  error?: any
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

type LiveResult<T> = {
  result: T
  tablenames: QualifiedTablename[]
}

function errorResult<T>(error: any): ResultData<T> {
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
 * @param runQuery - A live query.
 */
function useLiveQuery<Res>(
  runQuery: () => Promise<LiveResult<Res>>
): ResultData<Res> {
  const electric = useContext(ElectricContext)

  const [cacheKey, bustCache] = useRandom()
  const [changeSubscriptionKey, setChangeSubscriptionKey] = useState<string>()
  const [tablenames, setTablenames] = useState<QualifiedTablename[]>()
  const [tablenamesKey, setTablenamesKey] = useState<string>()
  const [resultData, setResultData] = useState<ResultData<Res>>({})

  let cleanedUp = false
  const cleanUp = () => {
    cleanedUp = true
  }
  const cleanly = (setterFn: AnyFunction, ...args: any[]) => {
    if (cleanedUp) {
      return
    }

    return setterFn(...args)
  }

  // The effect below is run only after the initial render
  // because of the empty array of dependencies
  useEffect(() => {
    // Do an initial run of the query to fetch the table names
    const runInitialQuery = async () => {
      try {
        const res = await runQuery()
        const tablenamesKey = JSON.stringify(res.tablenames)

        cleanly(setTablenames, res.tablenames)
        cleanly(setTablenamesKey, tablenamesKey)
        cleanly(setResultData, successResult(res.result))
      } catch (err) {
        cleanly(setResultData, errorResult(err))
      }
    }

    runInitialQuery()

    return cleanUp
  }, [])

  // Once we have electric, we then establish the data change
  // notification subscription, comparing the tablenames used by the
  // query with the changed tablenames in the data change notification
  // to determine whether to re-query or not.
  //
  // If we do need to re-query, then we call `bustCache` to set a new
  // `cacheKey`, which is a dependency of the next useEffect below
  useEffect(() => {
    if (
      electric === undefined ||
      tablenamesKey === undefined ||
      tablenames === undefined
    ) {
      return
    }

    const notifier = electric.notifier
    const handleChange = (notification: ChangeNotification): void => {
      // Reduces the `ChangeNotification` to an array of namespaced tablenames,
      // in a way that supports both the main namespace for the primary database
      // and aliases for any attached databases.
      const changedTablenames = notifier.alias(notification)

      if (hasIntersection(tablenames, changedTablenames)) {
        bustCache()
      }
    }

    const key = notifier.subscribeToDataChanges(handleChange)
    if (changeSubscriptionKey !== undefined) {
      notifier.unsubscribeFromDataChanges(changeSubscriptionKey)
    }

    setChangeSubscriptionKey(key)

    return () => notifier.unsubscribeFromDataChanges(key)
  }, [electric, tablenamesKey, tablenames])

  // Once we have the subscription established, we're ready to query the database
  // and then setResults or setError depending on whether the query succeeds.
  //
  // We re-run this function whenever the query, params or cache key change --
  // the query is proxied in the dependencies by the tablenamesKey, the params are
  // converted to a string so they're compared by value rather than reference and
  // the cacheKey is updated whenever a data change notification is received that
  // may potentially change the query results.
  useEffect(() => {
    if (electric === undefined || changeSubscriptionKey === undefined) {
      return
    }

    const runLiveQuery = async () => {
      try {
        const res = await runQuery()

        cleanly(setResultData, successResult(res.result))
      } catch (err) {
        cleanly(setResultData, errorResult(err))
      }
    }

    runLiveQuery()

    return cleanUp
  }, [electric, changeSubscriptionKey, cacheKey])

  return resultData
}

export default useLiveQuery
