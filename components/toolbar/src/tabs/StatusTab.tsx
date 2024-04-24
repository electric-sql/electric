import React, { useEffect, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'
import { ConnectivityState } from 'electric-sql/util'

export default function StatusTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [status, setStatus] = useState<ConnectivityState | null>(null)

  useEffect(() => {
    const interval = setInterval(
      () => setStatus(api.getSatelliteStatus(dbName)),
      300,
    )
    return () => clearInterval(interval)
  }, [])

  if (!status) {
    return <div>Waiting for satellite process...</div>
  }

  return (
    <div>
      <ul>
        <li>status: {status.status}</li>
        {status.reason && <li>reason: {status.reason.message}</li>}
      </ul>
    </div>
  )
}
