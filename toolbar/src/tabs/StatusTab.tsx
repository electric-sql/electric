import React, { useEffect, useState } from 'react'
import { getApi } from '../api'
import { ToolbarTabsProps } from '../tabs'

export default function StatusTab({ dbName }: ToolbarTabsProps): JSX.Element {
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (dbName !== undefined) {
      setStatus(getApi().getSatelliteStatus(dbName))
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
