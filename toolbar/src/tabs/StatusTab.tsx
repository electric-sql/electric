import React, { useEffect, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'

export default function StatusTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (dbName !== undefined) {
      setStatus(api.getSatelliteStatus(dbName))
    }
  }, [])

  return (
    <div>
      <ul>
        <li>status: {status}</li>
      </ul>
    </div>
  )
}
