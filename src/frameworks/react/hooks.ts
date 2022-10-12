import { useEffect, useState } from 'react'

import { ElectricNamespace } from '../../electric/index'
import { ChangeNotification } from '../../notifiers/index'
import { randomValue } from '../../util/random'
import { QualifiedTablename, hasIntersection } from '../../util/tablename'
import { BindParams, Query, Row } from '../../util/types'

import { useElectric } from './provider'

interface ResultData {
  error?: any,
  results?: Row[],
  updatedAt?: Date
}

const successResult = (results: Row[]): ResultData => {
  return {
    error: undefined,
    results: results,
    updatedAt: new Date()
  }
}

const errorResult = (error: any): ResultData => {
  return {
    error: error,
    results: undefined,
    updatedAt: new Date()
  }
}

// Utility hook for a random value that sets the value to a random
// string on create and provides an update function that generates
// and assigns the value to a new random string.
export const useRandom = () => {
  const [ value, _setValue ] = useState<string>(randomValue())
  const setRandomValue = () => _setValue(randomValue())

  return [ value, setRandomValue ] as const
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
  // console.log('useElectricQuery')

  const db = useElectric()

  const [ cacheKey, bustCache ] = useRandom()
  const [ changeSubscriptionKey, setChangeSubscriptionKey ] = useState<string>()
  const [ electric, setElectric ] = useState<ElectricNamespace>()
  const [ paramsKey, setParamsKey ] = useState<string>()
  const [ tablenames, setTablenames ] = useState<QualifiedTablename[]>()
  const [ tablenamesKey, setTablenamesKey ] = useState<string>()
  const [ resultData, setResultData ] = useState<ResultData>({})

  // When the db is set on the provider, we get the electric namespace from it.
  useEffect(() => {
    if (db === undefined) {
      return
    }

    // console.log('setElectric')
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

    // console.log('setParamsKey', paramsKey)
    setParamsKey(paramsKey)

    // console.log('setTablenames', tablenames)
    setTablenames(tablenames)

    // console.log('setTablenamesKey', tablenamesKey)
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

    // console.log('notifier.subscribeToDataChanges')
    const key = notifier.subscribeToDataChanges(handleChange)
    if (changeSubscriptionKey !== undefined) {
      // console.log('notifier.unsubscribeFromDataChanges')
      notifier.unsubscribeFromDataChanges(changeSubscriptionKey)
    }

    // console.log('setChangeSubscriptionKey', key)
    setChangeSubscriptionKey(key)

    return () => notifier.unsubscribeFromDataChanges(key)
  }, [electric, tablenamesKey])

  // Once we have the subscription established, we're ready to query the database
  // and then setResults or setError depending on whether the query succeeds.
  //
  // We re-run this function whenever the query, params or cache key change --
  // the query is proxied in the dependencies by the tablenamesKey, the params are
  // converted to a string so they're compared by value rather than reference and
  // the cacheKey is updated whenever a data change notification is recieved that
  // may potentially change the query results.
  useEffect(() => {
    if (electric === undefined || changeSubscriptionKey === undefined) {
      return
    }

    // console.log('electric.adapter.query', query, params)
    electric.adapter.query({ sql: query, args: params })
      .then((res: Row[]) => {
        // console.log('query success result', res)

        setResultData(successResult(res))
      })
      .catch((err: any) => {
        console.log('query error', err)

        setResultData(errorResult(err))
      })
  }, [electric, changeSubscriptionKey, cacheKey, paramsKey])

  // console.log('returning resultData', resultData)
  return resultData
}
