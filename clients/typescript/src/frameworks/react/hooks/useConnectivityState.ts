import { useContext, useEffect, useState } from 'react'
import { ConnectivityState } from '../../../util/types'
import { createConnectivityStateSubscribeFunction } from '../../../util'
import { ElectricContext } from '../provider'
import {
  getElectricConnectivityState,
  getValidConnectivityState,
} from '../../shared'

type ConnectivityHook = () => ConnectivityState

/**
 * React Hook to observe Electric's connectivity state
 */
const useConnectivityState: ConnectivityHook = () => {
  const electric = useContext(ElectricContext)
  const initialState: ConnectivityState = getElectricConnectivityState(electric)
  const [state, setState] = useState<ConnectivityState>(initialState)

  useEffect(() => {
    if (electric === undefined) return
    const unsubscribe = createConnectivityStateSubscribeFunction(
      electric.notifier
    )((newState) => setState(getValidConnectivityState(newState)))
    setState(getElectricConnectivityState(electric))
    return unsubscribe
  }, [electric])

  return state
}

export default useConnectivityState
