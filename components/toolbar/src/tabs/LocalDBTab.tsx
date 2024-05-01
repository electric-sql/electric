import { type JSX } from 'preact'
import { ToolbarTabsProps } from '../tabs'

export default function LocalDBTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  return (
    <div>
      <h3>{dbName}</h3>
      <button onClick={() => api.resetDb(dbName)}>RESET </button>
    </div>
  )
}
