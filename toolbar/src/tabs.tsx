import React, { useState } from 'react'

import LocalDBTab from './tabs/LocalDBTab'
import SQLTab from './tabs/SQLTab'
import StatusTab from './tabs/StatusTab'
import { ToolbarInterface } from './api/toolbar-interface'



function TabItem(
    label: string,
    name: 'status' | 'db' | 'sql',
    handleClick: (
    name: 'status' | 'db' | 'sql',
    e: React.MouseEvent<HTMLLIElement>,
  ) => void,
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
  const [active, setActive] = useState<'status' | 'db' | 'sql'>('status')
  function handleClick(
    name: 'status' | 'db' | 'sql',
     _e: React.MouseEvent<HTMLLIElement>,
  ) {
    setActive(name)
  }

  function renderComp() {
    switch (active) {
      case 'db':
        return <LocalDBTab dbName={dbName} api={api} />
      case 'sql':
        return <SQLTab dbName={dbName} api={api} />
      default:
        return <StatusTab dbName={dbName} api={api} />
    }
  }

  return (
    <div className="Toolbar-tabs">
      <ul className="Toolbar-tab-items">
        {TabItem('Connection', 'status', handleClick, active)}
        {TabItem('Local DB', 'db', handleClick, active)}
        {TabItem('Shell', 'sql', handleClick, active)}
      </ul>
      <div className="Toolbar-tab-content">{renderComp()}</div>
    </div>
  )
}
