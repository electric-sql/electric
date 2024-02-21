import { useContext, useEffect, useState } from 'react'

import { ElectricNamespace } from '../../../electric'
import { ConnectivityStateChangeNotification as Notification } from '../../../notifiers'
import { ConnectivityState } from '../../../util/types'
import { ElectricContext } from '../provider'

type ConnectivityHook = () => ConnectivityState

const STATES: {
  connected: ConnectivityState
  disconnected: ConnectivityState
} = {
  connected: { status: 'connected' },
  disconnected: { status: 'disconnected' },
}
const VALID_STATUSES = Object.values(STATES).map((s) => s.status)

const getElectricState = (electric?: ElectricNamespace) => {
  if (electric === undefined) {
    return STATES.disconnected
  }

  return electric.isConnected ? STATES.connected : STATES.disconnected
}

const getValidState = (candidateState: ConnectivityState) =>
  VALID_STATUSES.includes(candidateState.status)
    ? candidateState
    : STATES.disconnected

/**
 * React Hook to observe Electric's connectivity state
 */
const useConnectivityState: ConnectivityHook = () => {
  const electric = useContext(ElectricContext)
  const initialState: ConnectivityState = getElectricState(electric)
  const [state, setState] = useState<ConnectivityState>(initialState)

  useEffect(() => {
    let shouldStop = false

    if (electric === undefined) {
      return
    }

    setState(getElectricState(electric))

    const { notifier } = electric
    const handler = ({ connectivityState }: Notification) => {
      if (shouldStop) {
        return
      }

      setState(getValidState(connectivityState))
    }

    const unsubscribe = notifier.subscribeToConnectivityStateChanges(handler)

    return () => {
      shouldStop = true
      unsubscribe()
    }
  }, [electric])

  return state
}

export default useConnectivityState
