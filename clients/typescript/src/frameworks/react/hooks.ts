import { useContext, useEffect, useState } from 'react'

import {
  ChangeNotification,
  ConnectivityStateChangeNotification,
} from '../../notifiers/index'
import { randomValue } from '../../util/random'
import { QualifiedTablename, hasIntersection } from '../../util/tablename'
import { ConnectivityState } from '../../util/types'
import { ElectricContext } from './provider'

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
 * Utility hook for a random value that sets the value to a random
 * string on create and provides an update function that generates
 * and assigns the value to a new random string.
 */
export const useRandom = () => {
  const [value, _setValue] = useState<string>(randomValue())
  const setRandomValue = () => _setValue(randomValue())

  return [value, setRandomValue] as const
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
export function useLiveQuery<Res>(
  runQuery: () => Promise<LiveResult<Res>>
): ResultData<Res> {
  const electric = useContext(ElectricContext)

  const [cacheKey, bustCache] = useRandom()
  const [changeSubscriptionKey, setChangeSubscriptionKey] = useState<string>()
  const [tablenames, setTablenames] = useState<QualifiedTablename[]>()
  const [tablenamesKey, setTablenamesKey] = useState<string>()
  const [resultData, setResultData] = useState<ResultData<Res>>({})

  // The effect below is run only after the initial render
  // because of the empty array of dependencies
  useEffect(() => {
    // Do an initial run of the query to fetch the table names
    runQuery()
      .then((res) => {
        const tablenamesKey = JSON.stringify(res.tablenames)
        setTablenames(res.tablenames)
        setTablenamesKey(tablenamesKey)
        setResultData(successResult(res.result))
      })
      .catch((err) => setResultData(errorResult(err)))
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

    runQuery()
      .then((res) => setResultData(successResult(res.result)))
      .catch((err) => {
        setResultData(errorResult(err))
      })
  }, [electric, changeSubscriptionKey, cacheKey])

  return resultData
}

export const useConnectivityState: () => {
  connectivityState: ConnectivityState
  toggleConnectivityState: () => void
} = () => {
  const electric = useContext(ElectricContext)

  const [connectivityState, setConnectivityState] =
    useState<ConnectivityState>('disconnected')
  //const [electric, setElectric] = useState<ElectricNamespace>()

  useEffect(() => {
    if (electric === undefined) {
      return
    }

    setConnectivityState(electric.isConnected ? 'connected' : 'disconnected')

    const handler = (notification: ConnectivityStateChangeNotification) => {
      const state = notification.connectivityState

      // externally map states to disconnected/connected
      const nextState = ['available', 'error', 'disconnected'].find(
        (x) => x == state
      )
        ? 'disconnected'
        : 'connected'
      setConnectivityState(nextState)
    }

    electric.notifier.subscribeToConnectivityStateChange(handler)
  }, [electric])

  const toggleConnectivityState = () => {
    if (electric === undefined) {
      return
    }

    const nextState: ConnectivityState =
      connectivityState == 'connected' ? 'disconnected' : 'available'
    const dbName = electric.notifier.dbName
    electric.notifier.connectivityStateChange(dbName, nextState)
    setConnectivityState(nextState)
  }

  return { connectivityState, setConnectivityState, toggleConnectivityState }
}
