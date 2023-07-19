import { useContext, useEffect, useState } from 'react'

import { ConnectivityStateChangeNotification } from '../../../notifiers'
import { ConnectivityState } from '../../../util/types'
import { ElectricContext } from '../provider'

const useConnectivityState: () => {
  connectivityState: ConnectivityState
  toggleConnectivityState: () => void
} = () => {
  const electric = useContext(ElectricContext)
  const [connectivityState, setConnectivityState] = useState<ConnectivityState>('disconnected')

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

    const subscriptionKey = notifier.subscribeToConnectivityStateChange(handler)

    return () => {
      notifier.unsubscribeFromConnectivityStateChange(subscriptionKey)
    }
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

export default useConnectivityState
