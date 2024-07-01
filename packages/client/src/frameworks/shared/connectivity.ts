import { ElectricNamespace } from '../../electric'
import { ConnectivityState } from '../../util/types'

const STATES: {
  connected: ConnectivityState
  disconnected: ConnectivityState
} = {
  connected: { status: 'connected' },
  disconnected: { status: 'disconnected' },
}
const VALID_STATUSES = Object.values(STATES).map((s) => s.status)

export const getElectricConnectivityState = (electric?: ElectricNamespace) => {
  if (electric === undefined) {
    return STATES.disconnected
  }

  return electric.isConnected ? STATES.connected : STATES.disconnected
}

export const getValidConnectivityState = (candidateState: ConnectivityState) =>
  VALID_STATUSES.includes(candidateState.status)
    ? candidateState
    : STATES.disconnected
