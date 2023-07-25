import { useContext, useEffect, useState } from 'react'

import { ConnectivityStateChangeNotification } from '../../../notifiers'
import { ConnectivityState } from '../../../util/types'
import { ElectricContext } from '../provider'

/**
 * React Hook to observe and manage Electric's connectivity state
 */
const useConnectivityState: () => {
  connectivityState: ConnectivityState
  toggleConnectivityState: () => void
} = () => {
  const electric = useContext(ElectricContext)
  const [connectivityState, setConnectivityState] =
    useState<ConnectivityState>('disconnected')

  useEffect(() => {
    if (electric === undefined) {
      return
    }

    const { isConnected, notifier } = electric
    setConnectivityState(isConnected ? 'connected' : 'disconnected')

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

    const subscriptionKey =
      notifier.subscribeToConnectivityStateChanges(handler)

    return () => {
      notifier.unsubscribeFromConnectivityStateChanges(subscriptionKey)
    }
  }, [electric])

  const toggleConnectivityState = () => {
    if (electric === undefined) {
      return
    }

    const nextState: ConnectivityState =
      connectivityState == 'connected' ? 'disconnected' : 'available'
    const dbName = electric.notifier.dbName
    electric.notifier.connectivityStateChanged(dbName, nextState)
    setConnectivityState(nextState)
  }

  return { connectivityState, setConnectivityState, toggleConnectivityState }
}

export default useConnectivityState
