import { useContext, useEffect, useState } from 'react'

import { ElectricNamespace } from '../../../electric'
import { ConnectivityStateChangeNotification as Notification } from '../../../notifiers'
import { ConnectivityState } from '../../../util/types'
import { ElectricContext } from '../provider'

type RetVal = {
  connectivityState: ConnectivityState
  setConnectivityState: (state: ConnectivityState) => void
  toggleConnectivityState: () => void
}
type HookFn = () => RetVal

const STATES: {
  available: ConnectivityState
  connected: ConnectivityState
  disconnected: ConnectivityState
} = {
  available: { status: 'available' },
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

const getNextState = (currentState: ConnectivityState) =>
  currentState === STATES.connected ? STATES.disconnected : STATES.available

const getValidState = (candidateState: ConnectivityState) =>
  VALID_STATUSES.includes(candidateState.status)
    ? candidateState
    : STATES.disconnected

/**
 * React Hook to observe and manage Electric's connectivity state
 */
const useConnectivityState: HookFn = () => {
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

  const toggleState = () => {
    if (electric === undefined) {
      return
    }

    const nextState = getNextState(state)

    const { notifier } = electric
    const { dbName } = notifier

    notifier.connectivityStateChanged(dbName, nextState)

    setState(nextState)
  }

  return {
    connectivityState: state,
    setConnectivityState: setState,
    toggleConnectivityState: toggleState,
  }
}

export default useConnectivityState
