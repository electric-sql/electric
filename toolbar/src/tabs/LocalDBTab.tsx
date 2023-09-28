import React from 'react'
import { getApi } from '../client/api'
import { ToolbarTabsProps } from '../tabs'

export default function LocalDBTab({ dbName }: ToolbarTabsProps): JSX.Element {
  return (
    <div>
      <h3>{dbName}</h3>
      <button onClick={() => getApi().resetDB(dbName)}>RESET INDEXDB </button>
    </div>
  )
}
