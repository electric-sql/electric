import { useEffect, useState } from 'react'

import { ElectricNamespace } from '../../electric/index'
import {
  ChangeNotification,
  ConnectivityStateChangeNotification,
} from '../../notifiers/index'
import { randomValue } from '../../util/random'
import { QualifiedTablename, hasIntersection } from '../../util/tablename'
import { BindParams, ConnectivityState, Query, Row } from '../../util/types'

import { useElectric } from './provider'

interface ResultData<T> {
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

// Utility hook for a random value that sets the value to a random
// string on create and provides an update function that generates
// and assigns the value to a new random string.
export const useRandom = () => {
  const [value, _setValue] = useState<string>(randomValue())
  const setRandomValue = () => _setValue(randomValue())

  return [value, setRandomValue] as const
}

// Main reactive query hook for React applications. It needs to be
// used in tandem with the `ElectricProvider` in `./provider` which
// sets an `ElectricNamespace` as the `electric` value. This provides
// a notifier which this hook uses to subscribe to data change
// notifications to matching tables.
export function useLiveQuery<Res>(
  runQuery: () => Promise<LiveResult<Res>>
): ResultData<Res> {
  const db = useElectric()

  const [cacheKey, bustCache] = useRandom()
  const [changeSubscriptionKey, setChangeSubscriptionKey] = useState<string>()
  const [electric, setElectric] = useState<ElectricNamespace>()
  const [tablenames, setTablenames] = useState<QualifiedTablename[]>()
  const [tablenamesKey, setTablenamesKey] = useState<string>()
  const [resultData, setResultData] = useState<ResultData<Res>>({})

  // TODO: run query first time then fetch the DB tables

  // When the db is set on the provider, we get the electric namespace from it.
  useEffect(() => {
    if (db === undefined) {
      return
    }

    // Do an initial run of the query to fetch the table names
    runQuery()
      .then((res) => {
        const tablenamesKey = JSON.stringify(res.tablenames)
        setTablenames(res.tablenames)
        setTablenamesKey(tablenamesKey)
        setResultData(successResult(res.result))
      })
      .catch((err) => setResultData(errorResult(err)))

    setElectric(db.electric)
  }, [db])

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

// Main reactive query hook for React applications. It needs to be
// used in tandem with the `ElectricProvider` in `./provider` which
// sets an `ElectricNamespace` as the `electric` value. This provides
// an adapter and notifier which this hook uses to:
//
// 1. parse the tablenames out of the query
// 2. subscribe to data change notifications to matching tables
// 3. (re)-run the query whenever the underlying data potentially changes
//
// Running the query successfully will assign a new array of rows to
// the `results` state variable. Or if the query errors, the error will
// be assigned to the `error` variable.
//
// Returns an object that provides the `ResultData` interface of
// `{ results, error, updatedAt }`.
export const useElectricQuery = (query: Query, params?: BindParams) => {
  const db = useElectric()

  const [cacheKey, bustCache] = useRandom()
  const [changeSubscriptionKey, setChangeSubscriptionKey] = useState<string>()
  const [electric, setElectric] = useState<ElectricNamespace>()
  const [paramsKey, setParamsKey] = useState<string>()
  const [tablenames, setTablenames] = useState<QualifiedTablename[]>()
  const [tablenamesKey, setTablenamesKey] = useState<string>()
  const [resultData, setResultData] = useState<ResultData<Row[]>>({})

  // When the db is set on the provider, we get the electric namespace from it.
  useEffect(() => {
    if (db === undefined) {
      return
    }

    setElectric(db.electric)
  }, [db])

  // Use the `adapter` to parse the tablenames from the SQL query.
  useEffect(() => {
    if (electric === undefined) {
      return
    }

    const paramsKey = JSON.stringify(params)
    const tablenames = electric.adapter.tableNames({ sql: query })
    const tablenamesKey = JSON.stringify(tablenames)

    setParamsKey(paramsKey)

    setTablenames(tablenames)

    setTablenamesKey(tablenamesKey)
  }, [electric])

  // Once we have the tablenames, we then establish the data change
  // notification subscription, comparing the tablenames used by the
  // query with the changed tablenames in the data change notification
  // to determine whether to re-query or not.
  //
  // If we do need to re-query, then we call `bustCache` to set a new
  // `cacheKey`, which is a dependency of the next useEffect below
  useEffect(() => {
    if (electric === undefined || tablenames === undefined) {
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
  }, [electric, tablenamesKey])

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

    electric.adapter
      .query({ sql: query, args: params })
      .then((res: Row[]) => {
        setResultData(successResult(res))
      })
      .catch((err: any) => {
        setResultData(errorResult(err))
      })
  }, [electric, changeSubscriptionKey, cacheKey, paramsKey])

  return resultData
}

export const useConnectivityState: () => {
  connectivityState: ConnectivityState
  toggleConnectivityState: () => void
} = () => {
  const db = useElectric()

  const [connectivityState, setConnectivityState] =
    useState<ConnectivityState>('disconnected')
  const [electric, setElectric] = useState<ElectricNamespace>()

  useEffect(() => {
    if (db === undefined) {
      return
    }

    setElectric(db.electric)
  }, [db])

  useEffect(() => {
    if (db === undefined || electric === undefined) {
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

    setElectric(db.electric)
  }, [db, electric])

  const toggleConnectivityState = () => {
    if (db === undefined || electric === undefined) {
      return
    }

    const nextState: ConnectivityState =
      connectivityState == 'connected' ? 'disconnected' : 'available'
    const dbName = db.electric.notifier.dbName
    electric.notifier.connectivityStateChange(dbName, nextState)
    setConnectivityState(nextState)
  }

  return { connectivityState, setConnectivityState, toggleConnectivityState }
}
