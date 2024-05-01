import { type JSX } from 'preact'
import { useState } from 'preact/hooks'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'
import { ToolbarInterface } from './api/interface'
import ShapesTab from './tabs/ShapesTab'

type TabName = 'status' | 'db' | 'sql' | 'shapes'

function TabItem(
  label: string,
  name: TabName,
  handleClick: (name: TabName) => void,
  active: string,
): JSX.Element {
  const className =
    active == name
      ? 'Toolbar-tab-item Toolbar-tab-item-active'
      : 'Toolbar-tab-item'
  return (
    <li className={className} onClick={handleClick.bind(null, name)}>
      {label}
    </li>
  )
}

export type ToolbarTabsProps = {
  dbName: string
  api: ToolbarInterface
}

export default function ToolbarTabs({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [active, setActive] = useState<TabName>('status')

  function renderComp() {
    switch (active) {
      case 'db':
        return <LocalDBTab dbName={dbName} api={api} />
      case 'sql':
        return <SQLTab dbName={dbName} api={api} />
      case 'shapes':
        return <ShapesTab dbName={dbName} api={api} />
      default:
        return <StatusTab dbName={dbName} api={api} />
    }
  }

  return (
    <div className="Toolbar-tabs">
      <ul className="Toolbar-tab-items">
        {TabItem('Connection', 'status', setActive, active)}
        {TabItem('Local DB', 'db', setActive, active)}
        {TabItem('Shapes', 'shapes', setActive, active)}
        {TabItem('Shell', 'sql', setActive, active)}
      </ul>
      <div className="Toolbar-tab-content">{renderComp()}</div>
    </div>
  )
}
