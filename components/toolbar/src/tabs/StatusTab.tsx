import { type JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { ToolbarTabsProps } from '../tabs'
import { ConnectivityState } from 'electric-sql/util'

export default function StatusTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [status, setStatus] = useState<ConnectivityState | null>(
    api.getSatelliteStatus(dbName),
  )

  useEffect(() => {
    const unsubscribe = api.subscribeToSatelliteStatus(dbName, setStatus)
    return unsubscribe
  }, [dbName, api])

  if (!status) {
    return <div>Waiting for satellite process...</div>
  }

  return (
    <div>
      <button onClick={() => api.toggleSatelliteStatus(dbName)}>
        TOGGLE CONNECTION
      </button>

      <ul>
        <li>status: {status.status}</li>
        {status.reason && <li>reason: {status.reason.message}</li>}
      </ul>
    </div>
  )
}
